// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/AggregatorV3Interface.sol";
import "./HoodGapMath.sol";

/// @title HoodGap - All-Gap Portfolio Insurance Protocol
/// @notice Overnight gap insurance for TSLA stock positions covering 5 gaps per week
contract HoodGap is ERC721, Ownable, ReentrancyGuard {
    using HoodGapMath for *;

    // ═══════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    // --- Premium allocation (basis points, sum = 10000) ---
    uint256 public constant CLAIM_RESERVE_BPS = 7700; // 77% → claim reserve
    uint256 public constant STAKER_YIELD_BPS = 1800; // 18% → staker yield
    uint256 public constant PROTOCOL_FEE_BPS = 300; // 3%  → protocol ops
    uint256 public constant BLACK_SWAN_BPS = 200; // 2%  → catastrophic buffer

    // --- Tier pricing: weekly rate in basis points of coverage ---
    //     -5% tier: $54/week for $500 coverage = 10.8%
    //    -10% tier: $3/week for $500 coverage  = 0.6%
    uint256 public constant TIER_5_RATE = 1080; // 10.80% of coverage per week
    uint256 public constant TIER_10_RATE = 60; // 0.60% of coverage per week

    // --- Thresholds (basis points) ---
    uint256 public constant THRESHOLD_5 = 500; // -5%
    uint256 public constant THRESHOLD_10 = 1000; // -10%

    // --- Coverage limits ---
    uint256 public constant MAX_POLICY_COVERAGE = 50000e6; // $50,000 USDC

    // --- Subscription plans ---
    uint256 public constant GAPS_PER_WEEK = 5;
    uint256 public constant PLAN_1_WEEK = 1;
    uint256 public constant PLAN_4_WEEKS = 4;
    uint256 public constant PLAN_8_WEEKS = 8;
    uint256 public constant DISCOUNT_4_WEEKS = 400; // 4% off
    uint256 public constant DISCOUNT_8_WEEKS = 1000; // 10% off

    // --- Secondary market ---
    uint256 public constant TRANSFER_FEE_BPS = 500; // 5% of premium on transfer

    // --- Guardian ---
    uint256 public constant FAILSAFE_DELAY = 48 hours;
    uint256 public constant MAX_QUEUE_PROCESS = 20;
    uint256 public constant VOLATILITY_TIMELOCK = 24 hours;

    // --- Math lib references ---
    uint256 public constant AVG_VOLATILITY = 5000; // 50% baseline

    // ═══════════════════════════════════════════════════════════════
    //  STRUCTS
    // ═══════════════════════════════════════════════════════════════

    struct Policy {
        address holder;
        uint256 coverage; // USDC (6 decimals)
        uint256 threshold; // basis points (500 or 1000)
        uint256 premium; // USDC (6 decimals)
        uint256 purchaseTime;
        uint256 closePrice; // Chainlink price at market close (8 decimals)
        uint256 gapWeek; // canonical week number
        uint256 gapDay; // 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
        bool settled;
        bool paidOut;
    }

    struct Subscription {
        address owner;
        uint256 coverage; // USDC (6 decimals) per gap
        uint256 threshold; // basis points
        uint256 premiumPerWeek; // after discount, USDC (6 decimals)
        uint256 startWeek; // first week
        uint256 totalWeeks; // 1, 4, or 8
        uint256 gapsMinted; // how many gap NFTs minted (max = totalWeeks × 5)
    }

    struct WithdrawalRequest {
        address staker;
        uint256 amount;
        uint256 requestTime;
        bool processed;
    }

    struct PendingChange {
        uint256 value;
        uint256 executeAfter;
        bool exists;
        string description;
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════

    // --- Immutables ---
    IERC20 public immutable USDC;
    AggregatorV3Interface public immutable priceOracle;

    // --- Pool ---
    uint256 public totalStaked;
    uint256 public totalCoverage;
    uint256 public reserveBalance;
    uint256 public blackSwanReserve;
    mapping(address => uint256) public stakerBalances;

    // --- Policies ---
    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // --- Subscriptions ---
    uint256 public nextSubscriptionId;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(uint256 => uint256) public policySubscriptionId;

    // --- Settlement ---
    mapping(uint256 => uint256) public splitRatios;
    mapping(uint256 => bool) public settlementApproved;
    mapping(uint256 => uint256) public settlementApprovedTime;

    // --- Withdrawal queue ---
    WithdrawalRequest[] public withdrawalQueue;
    mapping(address => uint256[]) public userWithdrawalRequests;
    uint256 public queueHead;

    // --- Pricing ---
    uint256 public currentVolatility = 5000;

    // --- Guardian timelock ---
    PendingChange public pendingVolatilityChange;

    // --- Admin ---
    bool public paused;
    address public treasury;

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════

    event ContractInitialized(address indexed usdc, address indexed oracle, address indexed guardian);
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
        uint256 closePrice,
        uint256 gapWeek,
        uint256 gapDay
    );
    event PolicySettled(uint256 indexed policyId, uint256 openPrice, uint256 adjustedClose, uint256 gap, bool paidOut);
    event PolicyPaidOut(uint256 indexed policyId, address indexed holder, uint256 amount, uint256 gap);

    event SettlementApproved(uint256 indexed week, uint256 splitRatio, string reason, uint256 timestamp);
    event FailsafeTriggered(uint256 indexed week, string reason);
    event ReserveUsed(uint256 shortfall, uint256 totalCoverage, uint256 policyId);

    event SubscriptionCreated(address indexed owner, uint256 indexed subId, uint256 numWeeks, uint256 totalPremium);
    event GapPolicyMinted(uint256 indexed subId, uint256 indexed policyId, uint256 gapWeek, uint256 gapDay);
    event PolicyTransferred(uint256 indexed policyId, address indexed from, address indexed to, uint256 fee);

    event VolatilityChangeQueued(uint256 newVolatility, uint256 executeAfter, string reason);
    event VolatilityUpdated(uint256 oldVolatility, uint256 newVolatility);
    event VolatilityChangeCancelled(uint256 timestamp);

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ═══════════════════════════════════════════════════════════════
    //  MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════

    constructor(address _usdc, address _oracle) ERC721("HoodGap Policy", "HGAP") Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_oracle != address(0), "Invalid oracle address");

        USDC = IERC20(_usdc);
        priceOracle = AggregatorV3Interface(_oracle);
        treasury = msg.sender;

        emit ContractInitialized(_usdc, _oracle, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW: WEEK & TIMING
    // ═══════════════════════════════════════════════════════════════

    function getWeekNumber(uint256 timestamp) public pure returns (uint256) {
        return HoodGapMath.getWeekNumber(timestamp);
    }

    function getMonday(uint256 weekNumber) public pure returns (uint256) {
        return HoodGapMath.getMonday(weekNumber);
    }

    function getFriday(uint256 weekNumber) public pure returns (uint256) {
        return HoodGapMath.getFriday(weekNumber);
    }

    function getMarketClose(uint256 weekNumber, uint256 dayIndex) public pure returns (uint256) {
        return HoodGapMath.getMarketClose(weekNumber, dayIndex);
    }

    function getNextMarketOpen(uint256 weekNumber, uint256 dayIndex) public pure returns (uint256) {
        return HoodGapMath.getNextMarketOpen(weekNumber, dayIndex);
    }

    /// @notice Get the current settlement week (the NEXT trading week)
    function getCurrentSettlementWeek() public view returns (uint256) {
        uint256 currentWeek = HoodGapMath.getWeekNumber(block.timestamp);
        uint256 mondayThisWeek = HoodGapMath.getMonday(currentWeek);
        return block.timestamp >= mondayThisWeek ? currentWeek : currentWeek;
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW: PRICING
    // ═══════════════════════════════════════════════════════════════

    function getUtilizationMultiplier(uint256 newCoverage) public view returns (uint256) {
        return HoodGapMath.getUtilizationMultiplier(totalCoverage, newCoverage, totalStaked);
    }

    function getVolatilityMultiplier() public view returns (uint256) {
        return HoodGapMath.getVolatilityMultiplier(currentVolatility, AVG_VOLATILITY);
    }

    /// @notice Get the weekly rate for a given threshold tier
    /// @param threshold Must be THRESHOLD_5 (500) or THRESHOLD_10 (1000)
    function getTierRate(uint256 threshold) public pure returns (uint256) {
        if (threshold == THRESHOLD_5) return TIER_5_RATE;
        if (threshold == THRESHOLD_10) return TIER_10_RATE;
        revert("Invalid threshold tier");
    }

    /// @notice Calculate weekly premium for a given coverage and threshold
    /// @param coverage USDC amount (6 decimals)
    /// @param threshold 500 (-5%) or 1000 (-10%)
    function calculatePremium(uint256 coverage, uint256 threshold) public view returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage amount");

        uint256 rate = getTierRate(threshold);
        uint256 basePremium = (coverage * rate) / 10000;

        uint256 utilMultiplier = getUtilizationMultiplier(coverage);
        uint256 volMultiplier = getVolatilityMultiplier();

        uint256 premium = (basePremium * utilMultiplier * volMultiplier) / 1e8;

        // Floor: 0.1% of coverage
        uint256 minPremium = coverage / 1000;
        if (premium < minPremium) return minPremium;

        // Ceiling: 95% of coverage
        uint256 maxPremium = (coverage * 95) / 100;
        require(premium <= maxPremium, "Pool liquidity exhausted");

        return premium;
    }

    /// @notice Old calculatePremium signature for backward compat — uses -5% tier
    function calculatePremium(uint256 coverage) public view returns (uint256) {
        return calculatePremium(coverage, THRESHOLD_5);
    }

    function calculateGap(uint256 priceA, uint256 priceB) public pure returns (uint256) {
        return HoodGapMath.calculateGap(priceA, priceB);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW: SETTLEMENT GATE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Check whether a week can be settled
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

    // ═══════════════════════════════════════════════════════════════
    //  VIEW: POOL & QUEUE STATS
    // ═══════════════════════════════════════════════════════════════

    function getPoolStats()
        external
        view
        returns (
            uint256 _totalStaked,
            uint256 _totalCoverage,
            uint256 _utilization,
            uint256 _reserveBalance,
            uint256 _blackSwanReserve,
            uint256 _activePolicies
        )
    {
        uint256 util = totalStaked > 0 ? (totalCoverage * 10000) / totalStaked : 0;
        return (totalStaked, totalCoverage, util, reserveBalance, blackSwanReserve, nextPolicyId);
    }

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

    /// @notice Current pool utilization in basis points
    function getCurrentUtilization() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (totalCoverage * 10000) / totalStaked;
    }

    /// @notice Pre-flight check before buying
    function canBuyPolicy(
        address user,
        uint256 coverage,
        uint256 threshold
    ) external view returns (bool canBuy, string memory reason, uint256 estimatedPremium) {
        if (paused) return (false, "Contract paused", 0);
        if (coverage == 0) return (false, "Coverage must be > 0", 0);
        if (coverage > MAX_POLICY_COVERAGE) return (false, "Exceeds max coverage ($50k)", 0);
        if (threshold != THRESHOLD_5 && threshold != THRESHOLD_10)
            return (false, "Threshold must be -5% (500) or -10% (1000)", 0);

        try this.calculatePremium(coverage, threshold) returns (uint256 premium) {
            uint256 balance = USDC.balanceOf(user);
            uint256 allowance = USDC.allowance(user, address(this));

            if (balance < premium) return (false, "Insufficient USDC balance", premium);
            if (allowance < premium) return (false, "Insufficient USDC allowance", premium);

            return (true, "Ready to purchase", premium);
        } catch {
            return (false, "Pricing failed - oracle may be stale", 0);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  STAKING
    // ═══════════════════════════════════════════════════════════════

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

        emit WithdrawalQueued(msg.sender, amount, requestId, position, position * 3.5 days, block.timestamp);
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

    // ═══════════════════════════════════════════════════════════════
    //  POLICY PURCHASE — SINGLE GAP
    // ═══════════════════════════════════════════════════════════════

    /// @notice Buy a single overnight gap policy
    /// @param coverage USDC amount to insure
    /// @param threshold 500 (-5%) or 1000 (-10%)
    /// @param gapWeek Which week this gap covers
    /// @param gapDay Which day (0=Mon..4=Fri close → next open)
    function buyPolicy(
        uint256 coverage,
        uint256 threshold,
        uint256 gapWeek,
        uint256 gapDay
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage");
        require(threshold == THRESHOLD_5 || threshold == THRESHOLD_10, "Invalid threshold");
        require(gapDay <= 4, "gapDay must be 0-4");
        require(totalCoverage + coverage <= totalStaked, "Insufficient pool liquidity");

        // Single gap = 1/5 of weekly premium
        uint256 weeklyPremium = calculatePremium(coverage, threshold);
        uint256 premium = weeklyPremium / GAPS_PER_WEEK;
        if (premium == 0) premium = 1; // minimum 1 unit

        require(USDC.transferFrom(msg.sender, address(this), premium), "USDC transfer failed");
        _allocatePremium(premium);

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 24 hours, "Oracle price too stale");

        uint256 policyId = nextPolicyId++;

        policies[policyId] = Policy({
            holder: msg.sender,
            coverage: coverage,
            threshold: threshold,
            premium: premium,
            purchaseTime: block.timestamp,
            closePrice: uint256(answer),
            gapWeek: gapWeek,
            gapDay: gapDay,
            settled: false,
            paidOut: false
        });

        totalCoverage += coverage;
        _mint(msg.sender, policyId);

        emit PolicyPurchased(msg.sender, policyId, coverage, threshold, premium, uint256(answer), gapWeek, gapDay);
        return policyId;
    }

    /// @notice Legacy buyPolicy (2-arg) — buys a single gap for current week, day 4 (Fri→Mon)
    function buyPolicy(uint256 coverage, uint256 threshold) external nonReentrant whenNotPaused returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage");
        require(threshold == THRESHOLD_5 || threshold == THRESHOLD_10, "Invalid threshold");

        uint256 currentWeek = HoodGapMath.getWeekNumber(block.timestamp);
        require(totalCoverage + coverage <= totalStaked, "Insufficient pool liquidity");
        uint256 weeklyPremium = calculatePremium(coverage, threshold);

        require(USDC.transferFrom(msg.sender, address(this), weeklyPremium), "USDC transfer failed");
        _allocatePremium(weeklyPremium);

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 24 hours, "Oracle price too stale");

        uint256 policyId = nextPolicyId++;

        policies[policyId] = Policy({
            holder: msg.sender,
            coverage: coverage,
            threshold: threshold,
            premium: weeklyPremium,
            purchaseTime: block.timestamp,
            closePrice: uint256(answer),
            gapWeek: currentWeek,
            gapDay: 4, // default to Friday→Monday
            settled: false,
            paidOut: false
        });

        totalCoverage += coverage;
        _mint(msg.sender, policyId);

        emit PolicyPurchased(msg.sender, policyId, coverage, threshold, weeklyPremium, uint256(answer), currentWeek, 4);
        return policyId;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @notice Buy a subscription: 1 week (5 NFTs), 4 weeks (20 NFTs), or 8 weeks (40 NFTs)
    function buySubscription(
        uint256 coverage,
        uint256 threshold,
        uint256 numWeeks
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(coverage > 0 && coverage <= MAX_POLICY_COVERAGE, "Invalid coverage");
        require(threshold == THRESHOLD_5 || threshold == THRESHOLD_10, "Invalid threshold");
        require(
            numWeeks == PLAN_1_WEEK || numWeeks == PLAN_4_WEEKS || numWeeks == PLAN_8_WEEKS,
            "Must be 1, 4, or 8 weeks"
        );

        uint256 weeklyPremium = calculatePremium(coverage, threshold);

        // Apply multi-week discount
        uint256 discount = 0;
        if (numWeeks == PLAN_4_WEEKS) discount = DISCOUNT_4_WEEKS;
        else if (numWeeks == PLAN_8_WEEKS) discount = DISCOUNT_8_WEEKS;

        uint256 discountedWeekly = weeklyPremium - (weeklyPremium * discount) / 10000;
        uint256 totalPremium = discountedWeekly * numWeeks;

        require(USDC.transferFrom(msg.sender, address(this), totalPremium), "USDC transfer failed");
        _allocatePremium(totalPremium);

        uint256 subId = nextSubscriptionId++;
        uint256 startWeek = HoodGapMath.getWeekNumber(block.timestamp);

        subscriptions[subId] = Subscription({
            owner: msg.sender,
            coverage: coverage,
            threshold: threshold,
            premiumPerWeek: discountedWeekly,
            startWeek: startWeek,
            totalWeeks: numWeeks,
            gapsMinted: 0
        });

        emit SubscriptionCreated(msg.sender, subId, numWeeks, totalPremium);

        // Mint first gap NFT immediately
        _mintGapPolicy(subId);

        return subId;
    }

    /// @notice Mint the next gap NFT for a subscription (called by keeper or user)
    function mintGapPolicy(uint256 subId) external nonReentrant {
        _mintGapPolicy(subId);
    }

    /// @notice Batch mint all available gap NFTs for a subscription
    function mintAllAvailableGaps(uint256 subId) external nonReentrant {
        Subscription storage sub = subscriptions[subId];
        uint256 totalGaps = sub.totalWeeks * GAPS_PER_WEEK;
        uint256 minted = 0;

        while (sub.gapsMinted < totalGaps && minted < 10) {
            uint256 gapWeek = sub.startWeek + (sub.gapsMinted / GAPS_PER_WEEK);
            uint256 gapDay = sub.gapsMinted % GAPS_PER_WEEK;
            uint256 closeTime = HoodGapMath.getMarketClose(gapWeek, gapDay);

            if (block.timestamp < closeTime) break; // too early

            _mintGapPolicy(subId);
            minted++;
        }
    }

    function _mintGapPolicy(uint256 subId) internal {
        Subscription storage sub = subscriptions[subId];
        require(sub.totalWeeks > 0, "Subscription does not exist");

        uint256 totalGaps = sub.totalWeeks * GAPS_PER_WEEK;
        require(sub.gapsMinted < totalGaps, "All gaps already minted");

        uint256 gapWeek = sub.startWeek + (sub.gapsMinted / GAPS_PER_WEEK);
        uint256 gapDay = sub.gapsMinted % GAPS_PER_WEEK;

        // Can mint once the market close for this gap has passed
        uint256 closeTime = HoodGapMath.getMarketClose(gapWeek, gapDay);
        require(block.timestamp >= closeTime, "Market not closed yet for this gap");

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(block.timestamp - updatedAt < 24 hours, "Oracle price too stale");

        uint256 policyId = nextPolicyId++;
        uint256 perGapPremium = sub.premiumPerWeek / GAPS_PER_WEEK;

        policies[policyId] = Policy({
            holder: sub.owner,
            coverage: sub.coverage,
            threshold: sub.threshold,
            premium: perGapPremium,
            purchaseTime: block.timestamp,
            closePrice: uint256(answer),
            gapWeek: gapWeek,
            gapDay: gapDay,
            settled: false,
            paidOut: false
        });

        require(totalCoverage + sub.coverage <= totalStaked, "Insufficient pool liquidity");
        totalCoverage += sub.coverage;
        policySubscriptionId[policyId] = subId;
        sub.gapsMinted++;

        _mint(sub.owner, policyId);

        emit GapPolicyMinted(subId, policyId, gapWeek, gapDay);
        emit PolicyPurchased(
            sub.owner,
            policyId,
            sub.coverage,
            sub.threshold,
            perGapPremium,
            uint256(answer),
            gapWeek,
            gapDay
        );
    }

    /// @notice Get subscription details
    function getSubscription(uint256 subId) external view returns (Subscription memory) {
        return subscriptions[subId];
    }

    // ═══════════════════════════════════════════════════════════════
    //  SETTLEMENT
    // ═══════════════════════════════════════════════════════════════

    /// @notice Settle a gap policy after the next market open
    function settlePolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(!policy.settled, "Policy already settled");

        // The gap opens at the next market open after the close
        uint256 nextOpen = HoodGapMath.getNextMarketOpen(policy.gapWeek, policy.gapDay);
        require(block.timestamp >= nextOpen, "Too early to settle");

        // For Friday→Monday gaps, settlement approval is based on the NEXT week
        uint256 approvalWeek = policy.gapDay == 4 ? policy.gapWeek + 1 : policy.gapWeek;

        (bool allowed, uint256 splitRatio, string memory reason) = canSettle(approvalWeek);
        require(allowed, reason);

        if (!settlementApproved[approvalWeek]) {
            emit FailsafeTriggered(approvalWeek, "Defaulting to 1.0x split ratio");
        }

        (, int256 answer, , uint256 updatedAt, ) = priceOracle.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        require(updatedAt >= nextOpen, "Oracle not updated since market open");

        uint256 openPrice = uint256(answer);
        uint256 adjustedClose = (policy.closePrice * splitRatio) / 10000;
        uint256 gap = HoodGapMath.calculateGap(openPrice, adjustedClose);

        policy.settled = true;
        totalCoverage -= policy.coverage;

        // Binary payout: gap >= threshold → full coverage
        uint256 payout = HoodGapMath.calculatePayout(policy.coverage, gap, policy.threshold);

        if (payout > 0) {
            policy.paidOut = true;

            if (totalStaked < payout) {
                uint256 shortfall = payout - totalStaked;
                // Try black swan reserve first, then claim reserve
                if (blackSwanReserve >= shortfall) {
                    blackSwanReserve -= shortfall;
                } else {
                    uint256 remaining = shortfall - blackSwanReserve;
                    blackSwanReserve = 0;
                    require(reserveBalance >= remaining, "Insufficient pool + reserve funds");
                    reserveBalance -= remaining;
                }
                totalStaked = 0;
                emit ReserveUsed(shortfall, totalCoverage, policyId);
            } else {
                totalStaked -= payout;
            }

            address currentOwner = ownerOf(policyId);
            require(USDC.transfer(currentOwner, payout), "Payout transfer failed");
            emit PolicyPaidOut(policyId, currentOwner, payout, gap);
        }

        emit PolicySettled(policyId, openPrice, adjustedClose, gap, policy.paidOut);
        _tryProcessQueue();
    }

    // ═══════════════════════════════════════════════════════════════
    //  GUARDIAN: SETTLEMENT APPROVAL
    // ═══════════════════════════════════════════════════════════════

    function approveSettlement(uint256 week, uint256 splitRatio, string calldata reason) external onlyOwner {
        require(splitRatio > 0 && splitRatio <= 50000, "Split ratio out of range");

        splitRatios[week] = splitRatio;
        settlementApproved[week] = true;
        settlementApprovedTime[week] = block.timestamp;

        emit SettlementApproved(week, splitRatio, reason, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    //  GUARDIAN: VOLATILITY (24H TIMELOCK)
    // ═══════════════════════════════════════════════════════════════

    function queueVolatilityChange(uint256 newVolatility, string calldata reason) external onlyOwner {
        require(newVolatility >= 1000 && newVolatility <= 15000, "Volatility must be 10-150%");
        require(!pendingVolatilityChange.exists, "Change already pending");

        uint256 executeAfter = block.timestamp + VOLATILITY_TIMELOCK;
        pendingVolatilityChange = PendingChange({
            value: newVolatility,
            executeAfter: executeAfter,
            exists: true,
            description: reason
        });
        emit VolatilityChangeQueued(newVolatility, executeAfter, reason);
    }

    function executeVolatilityChange() external onlyOwner {
        require(pendingVolatilityChange.exists, "No pending volatility change");
        require(block.timestamp >= pendingVolatilityChange.executeAfter, "Timelock not elapsed");

        uint256 oldVol = currentVolatility;
        currentVolatility = pendingVolatilityChange.value;
        delete pendingVolatilityChange;
        emit VolatilityUpdated(oldVol, currentVolatility);
    }

    function cancelVolatilityChange() external onlyOwner {
        require(pendingVolatilityChange.exists, "No pending change");
        delete pendingVolatilityChange;
        emit VolatilityChangeCancelled(block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    //  GUARDIAN: EMERGENCY
    // ═══════════════════════════════════════════════════════════════

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Treasury cannot be zero address");
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TRANSFER FEE (ERC721 OVERRIDE)
    // ═══════════════════════════════════════════════════════════════

    /// @dev Collect 5% of premium as transfer fee on secondary sales
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Only charge fee on transfers (not mints or burns)
        if (from != address(0) && to != address(0)) {
            uint256 premium = policies[tokenId].premium;
            uint256 fee = (premium * TRANSFER_FEE_BPS) / 10000;
            if (fee > 0) {
                require(USDC.transferFrom(from, address(this), fee), "Transfer fee payment failed");
                reserveBalance += fee;
                emit PolicyTransferred(tokenId, from, to, fee);
            }
        }

        return super._update(to, tokenId, auth);
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEW: BATCH QUERIES
    // ═══════════════════════════════════════════════════════════════

    function getPolicies(uint256[] calldata policyIds) external view returns (Policy[] memory result) {
        result = new Policy[](policyIds.length);
        for (uint256 i = 0; i < policyIds.length; i++) {
            result[i] = policies[policyIds[i]];
        }
    }

    function getUserWithdrawals(address user) external view returns (WithdrawalRequest[] memory requests) {
        uint256[] memory ids = userWithdrawalRequests[user];
        requests = new WithdrawalRequest[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            requests[i] = withdrawalQueue[ids[i]];
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════

    /// @dev Split premium: 77% claim reserve, 18% staker yield (stays in pool),
    ///      3% protocol fee (to treasury), 2% black swan buffer
    function _allocatePremium(uint256 premium) internal {
        uint256 protocolFee = (premium * PROTOCOL_FEE_BPS) / 10000;
        uint256 claimReserve = (premium * CLAIM_RESERVE_BPS) / 10000;
        uint256 blackSwan = (premium * BLACK_SWAN_BPS) / 10000;
        // Staker yield (18%) stays in the contract as part of totalStaked implicitly
        // It's the remainder: premium - protocolFee - claimReserve - blackSwan

        reserveBalance += claimReserve;
        blackSwanReserve += blackSwan;

        if (protocolFee > 0) {
            require(USDC.transfer(treasury, protocolFee), "Protocol fee transfer failed");
        }
    }

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
