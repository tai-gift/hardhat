// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Raffle.sol";
import "./RaffleLib.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

// Factory Contract (Upgradeable)
contract RaffleFactory is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    mapping(uint256 => address) public draws;
    mapping(address => bool) public isValidDraw;
    uint256 public drawCount;

    uint256 public insuranceFund;
    uint256 public constant INSURANCE_FEE_PERCENTAGE = 1;

    event DrawCreated(uint256 indexed drawId, address drawAddress, RaffleLib.DrawConfig config);
    event DrawStarted(uint256 indexed drawId, address drawAddress);
    event DrawCompleted(uint256 indexed drawId, address drawAddress, address[] winners, uint256[] prizes);
    event DrawCompletedAlmostWinners(uint256 indexed drawId, address drawAddress, address[] almostWinners);
    event InsuranceFundUpdated(uint256 newBalance);
    event FundedShortfall(uint256 indexed drawId, address drawAddress, uint256 shortfall);
    event TicketPurchased(address drawAddress, address buyer, uint256 numberOfTickets, uint256 amount);

    // Initializer function for proxy pattern
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        drawCount = 0;
    }

    function createDraw(RaffleLib.DrawConfig memory config) external onlyOwner returns (uint256 drawId, address drawAddress) {
        require(config.startTime > block.timestamp, "Invalid start time");
        require(config.endTime > config.startTime, "Invalid end time");

        drawId = drawCount++;

        // Use the drawId as the salt for CREATE2
        bytes32 salt = keccak256(abi.encodePacked(drawId));

        // Deploy Raffle contract using CREATE2
        bytes memory bytecode = abi.encodePacked(type(Raffle).creationCode, abi.encode(address(this), config));
        drawAddress = _deployCreate2(bytecode, salt);

        draws[drawId] = drawAddress;
        isValidDraw[drawAddress] = true;

        emit DrawCreated(drawId, drawAddress, config);
    }

    function _deployCreate2(bytes memory bytecode, bytes32 salt) internal returns (address) {
        address addr;
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        require(addr != address(0), "CREATE2 deployment failed");
        return addr;
    }

    // Helper function to pre-compute the address for a Raffle contract
    function getPredictedAddress(uint256 drawId, RaffleLib.DrawConfig memory config) public view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(drawId));
        bytes memory bytecode = abi.encodePacked(type(Raffle).creationCode, abi.encode(address(this), config));
        return address(uint160(uint(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            salt,
            keccak256(bytecode)
        )))));
    }

    function startDraw(uint256 drawId) external onlyOwner {
        address drawAddress = draws[drawId];
        require(drawAddress != address(0), "Draw doesn't exist");

        Raffle(payable(drawAddress)).startDraw();
        emit DrawStarted(drawId, drawAddress);
    }

    function completeDraw(uint256 drawId) external {
        address drawAddress = draws[drawId];
        require(drawAddress != address(0), "Draw doesn't exist");

        Raffle draw = Raffle(payable(drawAddress));
        require(block.timestamp >= draw.getEndTime(), "Draw still ongoing");

        draw.completeDraw();

        (address[] memory winners, uint256[] memory prizes) = draw.getWinnersAndPrizes();
        emit DrawCompleted(drawId, drawAddress, winners, prizes);
        emit DrawCompletedAlmostWinners(drawId, drawAddress, draw.getAlmostWinners());
    }

    function getDrawAddress(uint256 drawId) external view returns (address) {
        return draws[drawId];
    }

    function getDrawStatus(uint256 drawId) external view returns (RaffleLib.DrawStatus memory) {
        address drawAddress = draws[drawId];
        require(drawAddress != address(0), "Draw doesn't exist");
        return Raffle(payable(drawAddress)).getStatus();
    }

    function fundDrawShortfall(uint256 drawId) external payable onlyOwner {
        address drawAddress = draws[drawId];
        require(drawAddress != address(0), "Draw doesn't exist");

        Raffle draw = Raffle(payable(drawAddress));

        RaffleLib.DrawConfig memory config = draw.getConfig();
        RaffleLib.DrawStatus memory status = draw.getStatus();

        require(block.timestamp >= draw.getEndTime(), "Draw still ongoing");
        require(!status.isComplete, "Draw already complete");
        require(config.guaranteedPrize > status.currentPrizePool, "No shortfall");
        require(config.guaranteedPrize > address(draw).balance, "Shortfall not needed");

        // calculate draw shortfall
        uint256 shortfall = config.guaranteedPrize - status.currentPrizePool;
        (bool success,) = payable(drawAddress).call{value: shortfall}("");
        require(success, "Failed to transfer shortfall");

        emit FundedShortfall(drawId, drawAddress, shortfall);
    }

    function notifyTicketPurchase(address buyer, uint256 numberOfTickets, uint256 amount) external {
        require(isValidDraw[msg.sender], "Invalid draw address");
        require(msg.sender != address(0), "Draw doesn't exist");

        emit TicketPurchased(msg.sender,  buyer, numberOfTickets, amount);
    }

    // To handle receiving Ether, use a receive function
    receive() external payable {}

    // Override the _authorizeUpgrade function to restrict upgrades to the owner
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
