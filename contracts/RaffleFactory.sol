// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Raffle.sol";
import "./RaffleNotifications.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

contract RaffleFactory is
Initializable,
OwnableUpgradeable,
PausableUpgradeable,
UUPSUpgradeable
{
    // State variables
    RaffleNotifications public notifications;
    address public raffleImplementation;

    // Raffle tracking
    mapping(address => bool) public isValidRaffle;
    address[] private allRaffles;
    uint256 public nextRaffleId;

    // Version tracking
    string public version;

    // Events
    event RaffleDeployed(
        address indexed raffleAddress,
        address indexed creator,
        uint256 indexed raffleId,
        address token,
        uint256 ticketPrice,
        uint256 duration,
        uint256 guaranteedPrizePool,
        uint256 timestamp
    );
    event RaffleImplementationUpdated(address newImplementation);
    event NotificationsUpdated(address newNotifications);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _notifications,
        address _raffleImplementation
    ) public initializer {
        require(_notifications != address(0), "Invalid notifications");
        require(_raffleImplementation != address(0), "Invalid implementation");

        __Ownable_init(msg.sender);
        __Pausable_init();
        __UUPSUpgradeable_init();

        notifications = RaffleNotifications(_notifications);
        raffleImplementation = _raffleImplementation;
        nextRaffleId = 1;
        version = "1.0.0";
    }

    /**
     * @notice Predict address of the next raffle
     */
    function predictNextRaffleAddress(
        address creator,
        address tokenAddress,
        uint256 ticketPrice,
        uint256 duration,
        uint256 guaranteedPrizePool
    ) public view returns (address predicted) {
        bytes32 salt = bytes32(nextRaffleId);
        bytes32 finalSalt = keccak256(abi.encodePacked(creator, salt));
        return Clones.predictDeterministicAddress(
            raffleImplementation,
            finalSalt,
            address(this)
        );
    }

    /**
     * @notice Deploy a new raffle contract
     */
    function deployRaffle(
        address tokenAddress,
        uint256 ticketPrice,
        uint256 duration,
        uint256 guaranteedPrizePool
    ) external whenNotPaused returns (address) {
        require(tokenAddress != address(0), "Invalid token");
        require(ticketPrice > 0, "Invalid price");
        require(duration >= 1 minutes, "Duration too short");
        require(duration <= 30 days, "Duration too long");
        require(guaranteedPrizePool > 0, "Invalid prize pool");

        bytes32 salt = bytes32(nextRaffleId);
        bytes32 finalSalt = keccak256(abi.encodePacked(msg.sender, salt));

        address clone = Clones.cloneDeterministic(raffleImplementation, finalSalt);

        Raffle(clone).initialize(
            tokenAddress,
            ticketPrice,
            duration,
            guaranteedPrizePool,
            address(notifications),
            msg.sender
        );

        isValidRaffle[clone] = true;
        allRaffles.push(clone);

        // Update next raffle ID
        uint256 currentId = nextRaffleId;
        nextRaffleId = currentId + 1;

        notifications.notifyRaffleCreated(
            clone,
            msg.sender,
            tokenAddress,
            ticketPrice,
            duration,
            guaranteedPrizePool
        );

        emit RaffleDeployed(
            clone,
            msg.sender,
            currentId,
            tokenAddress,
            ticketPrice,
            duration,
            guaranteedPrizePool,
            block.timestamp
        );

        return clone;
    }

    /**
     * @notice Get raffle by ID
     */
    function getRaffleById(uint256 raffleId) external view returns (address) {
        require(raffleId > 0 && raffleId < nextRaffleId, "Invalid raffle ID");
        bytes32 salt = bytes32(raffleId);
        bytes32 finalSalt = keccak256(abi.encodePacked(msg.sender, salt));
        return Clones.predictDeterministicAddress(
            raffleImplementation,
            finalSalt,
            address(this)
        );
    }

    // Rest of the contract remains the same...
    function updateRaffleImplementation(address _newImplementation) external onlyOwner {
        require(_newImplementation != address(0), "Invalid implementation");
        require(_newImplementation.code.length > 0, "Not a contract");
        raffleImplementation = _newImplementation;
        emit RaffleImplementationUpdated(_newImplementation);
    }

    function updateNotifications(address _notifications) external onlyOwner {
        require(_notifications != address(0), "Invalid notifications");
        require(_notifications.code.length > 0, "Not a contract");
        notifications = RaffleNotifications(_notifications);
        emit NotificationsUpdated(_notifications);
    }

    function getAllRaffles() external view returns (address[] memory) {
        return allRaffles;
    }

    function getRaffleCount() external view returns (uint256) {
        return allRaffles.length;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
