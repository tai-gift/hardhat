// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockErc20Token is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 500 * 10**18; // 1000 tokens
    uint256 public constant FAUCET_COOL_DOWN = 24 hours;

    mapping(address => uint256) public lastFaucetTime;

    constructor() ERC20("Mock Token", "MTK") Ownable(msg.sender) {
        // Mint 1 million tokens to the deployer
        _mint(msg.sender, 1000000 * 10**18);
    }

    function faucet() external {
        require(
            block.timestamp >= lastFaucetTime[msg.sender] + FAUCET_COOL_DOWN,
            "Please wait 24 hours between faucet requests"
        );

        lastFaucetTime[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    // Allow owner to mint additional tokens if needed
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
