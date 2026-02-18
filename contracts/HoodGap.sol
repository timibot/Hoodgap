// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/AggregatorV3Interface.sol";
import "./HoodGapMath.sol";

/// @title HoodGap - 24/7 Portfolio Insurance Protocol
/// @notice Weekend gap insurance for stock positions
contract HoodGap is ERC721, Ownable, ReentrancyGuard {
    using HoodGapMath for *;

    // --- Constants ---

    uint256 public constant BASE_RATE = 1000; // 10% annual base (3yr avg: ~1 in 9 Mondays)
    uint256 public constant PLATFORM_FEE = 200; // 2%
    uint256 public constant RESERVE_CUT = 500; // 5%
    uint256 public constant AVG_VOLATILITY = 5000; // 50% baseline
    uint256 public constant MAX_POLICY_COVERAGE = 50000e6; // $50,000 USDC
    uint256 public constant MIN_THRESHOLD = 500; // 5% minimum gap
    uint256 public constant MAX_THRESHOLD = 2000; // 20% maximum gap
    uint256 public constant FAILSAFE_DELAY = 48 hours;
    uint256 public constant MAX_QUEUE_PROCESS = 20;

    uint256 public constant VOLATILITY_TIMELOCK = 24 hours;
    uint256 public constant HOLIDAY_TIMELOCK = 24 hours;

    uint256 public constant REFERENCE_WEEK = HoodGapMath.REFERENCE_WEEK;
    uint256 public constant WEEKEND_DURATION = HoodGapMath.WEEKEND_DURATION;

    // --- Structs ---

    struct Policy {
        address holder;
        uint256 coverage; // USDC (6 decimals)
        uint256 threshold; // basis points
        uint256 premium; // USDC (6 decimals)
        uint256 purchaseTime;
        uint256 fridayClose; // Chainlink price (8 decimals)
        uint256 settlementWeek;
        bool settled;
        bool paidOut;
    }

    struct WithdrawalRequest {
        address staker;
        uint256 amount; // USDC (6 decimals)
        uint256 requestTime;
        bool processed;
    }

    struct PendingChange {
        uint256 value;
        uint256 executeAfter;
        bool exists;
        string description;
    }

    // --- Immutables ---

    IERC20 public immutable USDC;
    AggregatorV3Interface public immutable priceOracle;

    // --- Pool state ---

    uint256 public totalStaked;
    uint256 public totalCoverage;
    uint256 public reserveBalance;
    mapping(address => uint256) public stakerBalances;

    // --- Policies ---

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // --- Settlement ---

    mapping(uint256 => uint256) public splitRatios;
    mapping(uint256 => bool) public settlementApproved;
    mapping(uint256 => uint256) public settlementApprovedTime;
    mapping(uint256 => uint256) public holidayTimeMultipliers;

    // --- Withdrawal queue ---

    WithdrawalRequest[] public withdrawalQueue;
    mapping(address => uint256[]) public userWithdrawalRequests;
    uint256 public queueHead;

    // --- Pricing ---

    uint256 public currentVolatility = 5000;
    uint256 public fridayCloseTime;
    uint256 public mondayOpenTime;

    // --- Guardian timelock ---

    PendingChange public pendingVolatilityChange;
    mapping(uint256 => PendingChange) public pendingHolidayChanges;

    // --- Admin ---

    bool public paused;
    address public treasury;

    // --- Events ---

    event ContractInitialized(address indexed usdc, address indexed oracle, address indexed guardian);
    event WeekTimingUpdated(uint256 indexed week, uint256 fridayClose, uint256 mondayOpen);

    event Staked(address indexed staker, uint256 amount, uint256 timestamp);
    event WithdrawalProcessed(address indexed staker, uint256 amount, uint256 requestId, uint256 timestamp);
    event WithdrawalQueued(
        address indexed staker,
        uint256 amount,
        uint256 requestId,
        uint256 position,
        uint256 estimatedWait,
        uint256 timestamp
    );
    event WithdrawalCancelled(address indexed staker, uint256 requestId, uint256 timestamp);
    event QueueProcessed(uint256 processed, uint256 remainingLiquidity, uint256 newQueueHead);

    event PolicyPurchased(
        address indexed buyer,
        uint256 indexed policyId,
        uint256 coverage,
        uint256 threshold,
        uint256 premium,
        uint256 fridayClose,
        uint256 settlementWeek
    );
    event PolicySettled(
        uint256 indexed policyId,
        uint256 mondayPrice,
        uint256 adjustedFriday,
        uint256 gap,
        bool paidOut
    );
    event PolicyPaidOut(uint256 indexed policyId, address indexed holder, uint256 amount, uint256 gap);

    event SettlementApproved(uint256 indexed week, uint256 splitRatio, string reason, uint256 timestamp);
    event FailsafeTriggered(uint256 indexed week, string reason);
    event ReserveUsed(uint256 shortfall, uint256 totalCoverage, uint256 policyId);

    event VolatilityChangeQueued(uint256 newVolatility, uint256 executeAfter, string reason);
    event VolatilityUpdated(uint256 oldVolatility, uint256 newVolatility);
    event VolatilityChangeCancelled(uint256 timestamp);
    event HolidayChangeQueued(uint256 indexed week, uint256 multiplier, uint256 executeAfter, string reason);
    event HolidayMultiplierSet(uint256 indexed week, uint256 multiplier, string reason);
    event HolidayChangeCancelled(uint256 indexed week, uint256 timestamp);

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // --- Modifiers ---

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    // --- Constructor ---

    constructor(address _usdc, address _oracle) ERC721("HoodGap Policy", "HGAP") Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_oracle != address(0), "Invalid oracle address");

        USDC = IERC20(_usdc);
        priceOracle = AggregatorV3Interface(_oracle);
        treasury = msg.sender;

        uint256 currentWeek = HoodGapMath.getWeekNumber(block.timestamp);
        fridayCloseTime = HoodGapMath.getFriday(currentWeek);
        mondayOpenTime = HoodGapMath.getMonday(currentWeek + 1);

        emit ContractInitialized(_usdc, _oracle, msg.sender);
    }

    // --- Week timing ---

    /// @notice Refresh fridayCloseTime and mondayOpenTime for the current week
    function updateWeekTiming() public {
        uint256 currentWeek = HoodGapMath.getWeekNumber(block.timestamp);

        fridayCloseTime = HoodGapMath.getFriday(currentWeek);
        mondayOpenTime = HoodGapMath.getMonday(currentWeek + 1);

        emit WeekTimingUpdated(currentWeek, fridayCloseTime, mondayOpenTime);
    }

    // --- View: week calculations ---

    function getWeekNumber(uint256 timestamp) public pure returns (uint256) {
        return HoodGapMath.getWeekNumber(timestamp);
    }

    function getMonday(uint256 weekNumber) public pure returns (uint256) {
        return HoodGapMath.getMonday(weekNumber);
    }

    function getFriday(uint256 weekNumber) public pure returns (uint256) {
        return HoodGapMath.getFriday(weekNumber);
    }

    function getCurrentSettlementWeek() public view returns (uint256) {
        uint256 currentWeek = HoodGapMath.getWeekNumber(block.timestamp);
        uint256 mondayThisWeek = HoodGapMath.getMonday(currentWeek);
        return block.timestamp >= mondayThisWeek ? currentWeek + 1 : currentWeek;
    }

    // --- View: pricing ---

    function getUtilizationMultiplier(uint256 newCoverage) public view returns (uint256) {
        return HoodGapMath.getUtilizationMultiplier(totalCoverage, newCoverage, totalStaked);
    }

    function getVolatilityMultiplier() public view returns (uint256) {
        return HoodGapMath.getVolatilityMultiplier(currentVolatility, AVG_VOLATILITY);
    }

    function getTimeDecayMultiplier() public view returns (uint256) {
        (, , , uint256 updatedAt, ) = priceOracle.latestRoundData();
        uint256 settlementWeek = getCurrentSettlementWeek();
        uint256 holidayOverride = holidayTimeMultipliers[settlementWeek];

        return
            HoodGapMath.getTimeDecayMultiplier(
                fridayCloseTime,
                mondayOpenTime,
                updatedAt,
                block.timestamp,
                holidayOverride
            );
    }

    function calculatePremium(uint256 coverage) public view returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage amount");

        (, , , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(block.timestamp - updatedAt < 24 hours, "Oracle data is stale");

        uint256 basePremium = (coverage * BASE_RATE) / 10000;

        uint256 utilMultiplier = getUtilizationMultiplier(coverage);
        uint256 volMultiplier = getVolatilityMultiplier();
        uint256 timeMultiplier = getTimeDecayMultiplier();

        uint256 premium = (basePremium * utilMultiplier * volMultiplier * timeMultiplier) / 1e12;

        uint256 minPremium = coverage / 100;
        if (premium < minPremium) return minPremium;

        uint256 maxPremium = (coverage * 95) / 100;
        require(premium <= maxPremium, "Pool liquidity exhausted");

        return premium;
    }

    function calculateGap(uint256 priceA, uint256 priceB) public pure returns (uint256) {
        return HoodGapMath.calculateGap(priceA, priceB);
    }

    // --- View: settlement gate ---

    /// @notice Check whether a week can be settled
    /// @return allowed Whether settlement can proceed
    /// @return splitRatio Ratio to apply (10000 = 1.0x)
    /// @return reason Human-readable status
    function canSettle(uint256 week) public view returns (bool allowed, uint256 splitRatio, string memory reason) {
        if (settlementApproved[week]) {
            uint256 ratio = splitRatios[week];
            if (ratio == 0) ratio = 10000;
            return (true, ratio, "Guardian approved");
        }

        uint256 mondayOpen = HoodGapMath.getMonday(week);
        if (block.timestamp >= mondayOpen + FAILSAFE_DELAY) {
            return (true, 10000, "Failsafe: 48h timeout, defaulting 1.0x");
        }

        return (false, 0, "Awaiting guardian approval or 48h failsafe");
    }

    // --- View: queue stats ---

    function getQueueStats()
        external
        view
        returns (uint256 head, uint256 length, uint256 pending, uint256 dollarAhead, uint256 freeLiquidity)
    {
        head = queueHead;
        length = withdrawalQueue.length;

        for (uint256 i = queueHead; i < withdrawalQueue.length; i++) {
            if (!withdrawalQueue[i].processed) {
                pending++;
                dollarAhead += withdrawalQueue[i].amount;
            }
        }

        freeLiquidity = totalStaked > totalCoverage ? totalStaked - totalCoverage : 0;
    }

    // --- Staking ---

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(USDC.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        stakerBalances[msg.sender] += amount;
        totalStaked += amount;

        emit Staked(msg.sender, amount, block.timestamp);

        _tryProcessQueue();
    }

    function requestWithdrawal(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(stakerBalances[msg.sender] >= amount, "Insufficient staker balance");

        uint256 freeLiquidity = totalStaked > totalCoverage ? totalStaked - totalCoverage : 0;

        if (amount <= freeLiquidity) {
            _processWithdrawal(msg.sender, amount);
            emit WithdrawalProcessed(msg.sender, amount, 0, block.timestamp);
            return;
        }

        uint256 requestId = withdrawalQueue.length;
        withdrawalQueue.push(
            WithdrawalRequest({staker: msg.sender, amount: amount, requestTime: block.timestamp, processed: false})
        );

        userWithdrawalRequests[msg.sender].push(requestId);

        uint256 position = 0;
        for (uint256 i = queueHead; i < requestId; i++) {
            if (!withdrawalQueue[i].processed) position++;
        }

        uint256 estimatedWait = position * 3.5 days;

        emit WithdrawalQueued(msg.sender, amount, requestId, position, estimatedWait, block.timestamp);
    }

    function cancelWithdrawalRequest(uint256 requestId) external nonReentrant {
        require(requestId < withdrawalQueue.length, "Invalid request ID");
        WithdrawalRequest storage request = withdrawalQueue[requestId];
        require(request.staker == msg.sender, "Not your request");
        require(!request.processed, "Already processed");

        request.processed = true;
        _advanceQueueHead();

        emit WithdrawalCancelled(msg.sender, requestId, block.timestamp);
    }

    /// @notice Manually process withdrawal queue
    /// @param maxToProcess Maximum requests to process (1-50)
    function processWithdrawalQueue(uint256 maxToProcess) external {
        require(maxToProcess > 0 && maxToProcess <= 50, "Process 1-50 per call");

        uint256 freeLiquidity = totalStaked > totalCoverage ? totalStaked - totalCoverage : 0;
        if (freeLiquidity == 0) return;

        uint256 processed = 0;

        for (uint256 i = queueHead; i < withdrawalQueue.length && processed < maxToProcess && freeLiquidity > 0; i++) {
            WithdrawalRequest storage request = withdrawalQueue[i];

            if (request.processed) {
                if (i == queueHead) queueHead++;
                continue;
            }

            if (request.amount > freeLiquidity) break;

            _processWithdrawal(request.staker, request.amount);
            request.processed = true;
            freeLiquidity -= request.amount;
            processed++;

            queueHead = i + 1;

            emit WithdrawalProcessed(request.staker, request.amount, i, block.timestamp);
        }

        emit QueueProcessed(processed, freeLiquidity, queueHead);
    }

    // --- Policy purchase ---

    function buyPolicy(uint256 coverage, uint256 threshold) external nonReentrant whenNotPaused returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage");
        require(threshold >= MIN_THRESHOLD && threshold <= MAX_THRESHOLD, "Threshold must be 5-20%");
        require(totalCoverage + coverage <= totalStaked, "Insufficient pool liquidity");

        uint256 premium = calculatePremium(coverage);

        require(USDC.transferFrom(msg.sender, address(this), premium), "USDC transfer failed");

        uint256 platformFee = (premium * PLATFORM_FEE) / 10000;
        uint256 reserveCut = (premium * RESERVE_CUT) / 10000;

        reserveBalance += reserveCut;
        require(USDC.transfer(treasury, platformFee), "Platform fee transfer failed");

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 1 hours, "Oracle price too stale");

        uint256 policyId = nextPolicyId++;
        uint256 settlementWeek = getCurrentSettlementWeek();

        policies[policyId] = Policy({
            holder: msg.sender,
            coverage: coverage,
            threshold: threshold,
            premium: premium,
            purchaseTime: block.timestamp,
            fridayClose: uint256(answer),
            settlementWeek: settlementWeek,
            settled: false,
            paidOut: false
        });

        totalCoverage += coverage;
        _mint(msg.sender, policyId);

        emit PolicyPurchased(msg.sender, policyId, coverage, threshold, premium, uint256(answer), settlementWeek);

        return policyId;
    }

    // --- Settlement ---

    function settlePolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(!policy.settled, "Policy already settled");

        uint256 mondayOpen = HoodGapMath.getMonday(policy.settlementWeek);
        require(block.timestamp >= mondayOpen, "Too early to settle");

        (bool allowed, uint256 splitRatio, string memory reason) = canSettle(policy.settlementWeek);
        require(allowed, reason);

        if (!settlementApproved[policy.settlementWeek]) {
            emit FailsafeTriggered(policy.settlementWeek, "Defaulting to 1.0x split ratio");
        }

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(updatedAt >= mondayOpen, "Oracle not updated since Monday open");

        uint256 mondayPrice = uint256(answer);
        uint256 adjustedFriday = (policy.fridayClose * splitRatio) / 10000;
        uint256 gap = HoodGapMath.calculateGap(mondayPrice, adjustedFriday);

        policy.settled = true;
        totalCoverage -= policy.coverage;

        if (gap >= policy.threshold) {
            policy.paidOut = true;

            if (totalStaked < policy.coverage) {
                uint256 shortfall = policy.coverage - totalStaked;
                require(reserveBalance >= shortfall, "Insufficient pool + reserve funds");
                reserveBalance -= shortfall;
                totalStaked = 0;
                emit ReserveUsed(shortfall, totalCoverage, policyId);
            } else {
                totalStaked -= policy.coverage;
            }

            require(USDC.transfer(policy.holder, policy.coverage), "Payout transfer failed");
            emit PolicyPaidOut(policyId, policy.holder, policy.coverage, gap);
        }

        emit PolicySettled(policyId, mondayPrice, adjustedFriday, gap, policy.paidOut);

        _tryProcessQueue();
    }

    // --- Guardian: settlement approval ---

    function approveSettlement(uint256 week, uint256 splitRatio, string calldata reason) external onlyOwner {
        require(splitRatio > 0 && splitRatio <= 50000, "Split ratio out of range");

        splitRatios[week] = splitRatio;
        settlementApproved[week] = true;
        settlementApprovedTime[week] = block.timestamp;

        emit SettlementApproved(week, splitRatio, reason, block.timestamp);
    }

    // --- Guardian: volatility (24h timelock) ---

    /// @notice Queue a volatility change (step 1 of 2)
    function queueVolatilityChange(uint256 newVolatility, string calldata reason) external onlyOwner {
        require(newVolatility >= 1000 && newVolatility <= 15000, "Volatility must be 10-150%");
        require(!pendingVolatilityChange.exists, "Change already pending, cancel first");

        uint256 executeAfter = block.timestamp + VOLATILITY_TIMELOCK;

        pendingVolatilityChange = PendingChange({
            value: newVolatility,
            executeAfter: executeAfter,
            exists: true,
            description: reason
        });

        emit VolatilityChangeQueued(newVolatility, executeAfter, reason);
    }

    /// @notice Execute the queued volatility change (step 2 of 2)
    function executeVolatilityChange() external onlyOwner {
        require(pendingVolatilityChange.exists, "No pending volatility change");
        require(block.timestamp >= pendingVolatilityChange.executeAfter, "Timelock: 24h has not elapsed");

        uint256 oldVolatility = currentVolatility;
        currentVolatility = pendingVolatilityChange.value;

        delete pendingVolatilityChange;

        emit VolatilityUpdated(oldVolatility, currentVolatility);
    }

    function cancelVolatilityChange() external onlyOwner {
        require(pendingVolatilityChange.exists, "No pending change to cancel");
        delete pendingVolatilityChange;
        emit VolatilityChangeCancelled(block.timestamp);
    }

    // --- Guardian: holiday multiplier (24h timelock) ---

    /// @notice Queue a holiday multiplier (step 1 of 2)
    function queueHolidayMultiplier(uint256 week, uint256 multiplier, string calldata reason) external onlyOwner {
        require(multiplier >= 10000 && multiplier <= 50000, "Multiplier must be 1.0x-5.0x");
        require(!pendingHolidayChanges[week].exists, "Change already pending for this week");

        uint256 executeAfter = block.timestamp + HOLIDAY_TIMELOCK;

        pendingHolidayChanges[week] = PendingChange({
            value: multiplier,
            executeAfter: executeAfter,
            exists: true,
            description: reason
        });

        emit HolidayChangeQueued(week, multiplier, executeAfter, reason);
    }

    /// @notice Execute the queued holiday multiplier (step 2 of 2)
    function executeHolidayMultiplier(uint256 week) external onlyOwner {
        PendingChange storage pending = pendingHolidayChanges[week];
        require(pending.exists, "No pending change for this week");
        require(block.timestamp >= pending.executeAfter, "Timelock: 24h has not elapsed");

        uint256 multiplier = pending.value;
        string memory desc = pending.description;
        holidayTimeMultipliers[week] = multiplier;

        delete pendingHolidayChanges[week];

        emit HolidayMultiplierSet(week, multiplier, desc);
    }

    function cancelHolidayMultiplier(uint256 week) external onlyOwner {
        require(pendingHolidayChanges[week].exists, "No pending change to cancel");
        delete pendingHolidayChanges[week];
        emit HolidayChangeCancelled(week, block.timestamp);
    }

    // --- Guardian: emergency ---

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Update the treasury address that receives platform fees
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Treasury cannot be zero address");
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    // --- View: pool stats & policy queries ---

    function getPoolStats()
        external
        view
        returns (
            uint256 _totalStaked,
            uint256 _totalCoverage,
            uint256 _utilization,
            uint256 _reserveBalance,
            uint256 _activePolicies
        )
    {
        uint256 util = totalStaked > 0 ? (totalCoverage * 10000) / totalStaked : 0;

        return (totalStaked, totalCoverage, util, reserveBalance, nextPolicyId);
    }

    /// @notice Pre-flight check before calling buyPolicy()
    function canBuyPolicy(
        address user,
        uint256 coverage,
        uint256 threshold
    ) external view returns (bool canBuy, string memory reason, uint256 estimatedPremium) {
        if (paused) return (false, "Contract paused", 0);
        if (coverage == 0) return (false, "Coverage must be > 0", 0);
        if (coverage > MAX_POLICY_COVERAGE) return (false, "Exceeds max coverage ($50k)", 0);
        if (threshold < MIN_THRESHOLD || threshold > MAX_THRESHOLD)
            return (false, "Threshold must be 5-20% (500-2000 bp)", 0);
        if (totalCoverage + coverage > totalStaked) return (false, "Insufficient pool liquidity", 0);

        try this.calculatePremium(coverage) returns (uint256 premium) {
            uint256 balance = USDC.balanceOf(user);
            uint256 allowance = USDC.allowance(user, address(this));

            if (balance < premium) return (false, "Insufficient USDC balance", premium);
            if (allowance < premium) return (false, "Insufficient USDC allowance - call approve() first", premium);

            return (true, "Ready to purchase", premium);
        } catch {
            return (false, "Pricing failed - oracle may be stale", 0);
        }
    }

    /// @notice Batch-fetch policy structs by ID
    function getPolicies(uint256[] calldata policyIds) external view returns (Policy[] memory result) {
        result = new Policy[](policyIds.length);
        for (uint256 i = 0; i < policyIds.length; i++) {
            result[i] = policies[policyIds[i]];
        }
    }

    /// @notice Get all withdrawal requests for a user (includes processed)
    function getUserWithdrawals(address user) external view returns (WithdrawalRequest[] memory requests) {
        uint256[] memory ids = userWithdrawalRequests[user];
        requests = new WithdrawalRequest[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            requests[i] = withdrawalQueue[ids[i]];
        }
    }

    /// @notice Current pool utilization in basis points (0-10000)
    function getCurrentUtilization() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (totalCoverage * 10000) / totalStaked;
    }

    // --- Internal ---

    function _tryProcessQueue() internal {
        uint256 freeLiquidity = totalStaked > totalCoverage ? totalStaked - totalCoverage : 0;
        if (freeLiquidity == 0 || queueHead >= withdrawalQueue.length) return;

        uint256 processed = 0;

        for (
            uint256 i = queueHead;
            i < withdrawalQueue.length && processed < MAX_QUEUE_PROCESS && freeLiquidity > 0;
            i++
        ) {
            WithdrawalRequest storage request = withdrawalQueue[i];

            if (request.processed) {
                if (i == queueHead) queueHead++;
                continue;
            }

            if (request.amount > freeLiquidity) break;

            _processWithdrawal(request.staker, request.amount);
            request.processed = true;
            freeLiquidity -= request.amount;
            processed++;
            queueHead = i + 1;
        }

        if (processed > 0) {
            emit QueueProcessed(processed, freeLiquidity, queueHead);
        }
    }

    function _advanceQueueHead() internal {
        while (queueHead < withdrawalQueue.length && withdrawalQueue[queueHead].processed) {
            queueHead++;
        }
    }

    function _processWithdrawal(address staker, uint256 amount) internal {
        stakerBalances[staker] -= amount;
        totalStaked -= amount;
        require(USDC.transfer(staker, amount), "Withdrawal transfer failed");
    }
}
