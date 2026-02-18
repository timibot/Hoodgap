// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockChainlinkOracle
 * @dev Configurable Chainlink AggregatorV3Interface mock for tests only.
 *      Named per DAY1 spec: contracts/mocks/MockChainlinkOracle.sol
 */
contract MockChainlinkOracle {
    int256  public price;
    uint256 public updatedAt;
    uint80  public roundId;

    constructor(int256 _price, uint256 _updatedAt) {
        price     = _price;
        updatedAt = _updatedAt;
        roundId   = 1;
    }

    /// @notice Set a new price and timestamp (simulates oracle update)
    function update(int256 _price, uint256 _updatedAt) external {
        price     = _price;
        updatedAt = _updatedAt;
        roundId++;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80  _roundId,
            int256  answer,
            uint256 startedAt,
            uint256 _updatedAt,
            uint80  answeredInRound
        )
    {
        return (roundId, price, updatedAt, updatedAt, roundId);
    }

    function decimals()    external pure returns (uint8)         { return 8; }
    function description() external pure returns (string memory) { return "TSLA / USD"; }
    function version()     external pure returns (uint256)       { return 4; }
}
