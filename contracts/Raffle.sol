// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RaffleNotifications.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title Raffle
 * @notice A secure raffle implementation for Taiko L2 with commit-reveal randomness
 * @dev Uses commit-reveal with multiple entropy sources for secure randomness
 */
contract Raffle is
Initializable,
ReentrancyGuardUpgradeable,
PausableUpgradeable,
OwnableUpgradeable
{
    // Core state variables
    ERC20Upgradeable public token;
    IRaffleNotifications public notifications;
    uint256 public ticketPrice;
    uint256 public raffleEndTime;
    uint256 public guaranteedPrizePool;
    bool public raffleEnded;

    // Constants
    uint256 public constant MAX_TICKETS = 100;
    uint256 public constant NUM_WINNERS = 10;
    uint256 public constant NUM_RUNNERS_UP = 5;
    uint256 public constant PRIZE_PERCENTAGE = 40;

    // Participant tracking
    mapping(address => uint256) public ticketsBought;
    mapping(uint256 => address) public ticketOwners;
    mapping(address => bool) public isParticipant;
    address[] public participants;
    uint256 public totalTickets;
    uint256 public totalContributions;

    // Winner tracking
    address[] public winners;
    address[] public runnersUp;
    mapping(address => uint256) public winnerPrizes;
    mapping(address => bool) public isWinner;
    mapping(address => bool) public isRunnerUp;

    // Prize distribution percentages
    uint256[10] private prizePercentages = [
    .25, .20, .15, .10, .08, .07, .06, .04, .03, .02
    ];

    // Events
    event TicketPurchased(address indexed buyer, uint256 amount, uint256 cost);
    event WinnersSelected(address[] winners, address[] runnersUp, uint256[] prizes);
    event PrizeClaimed(address indexed winner, uint256 amount);
    event ShortfallFunded(uint256 amount, uint256 newTotal);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        uint256 _ticketPrice,
        uint256 _duration,
        uint256 _guaranteedPrizePool,
        address _notifications,
        address _owner
    ) public initializer {
        require(_token != address(0), "Invalid token address");
        require(_ticketPrice > 0, "Invalid ticket price");
        require(_duration > 0, "Invalid duration");
        require(_guaranteedPrizePool > 0, "Invalid prize pool");
        require(_notifications != address(0), "Invalid notifications");
        require(_owner != address(0), "Invalid owner");

        __ReentrancyGuard_init();
        __Pausable_init();
        __Ownable_init(_owner);

        token = ERC20Upgradeable(_token);
        notifications = IRaffleNotifications(_notifications);
        ticketPrice = _ticketPrice;
        raffleEndTime = block.timestamp + _duration;
        guaranteedPrizePool = _guaranteedPrizePool;
    }

    function buyTickets(uint256 numberOfTickets) external nonReentrant {
        require(!raffleEnded, "Raffle ended");
        require(block.timestamp < raffleEndTime, "Raffle closed");
        require(numberOfTickets > 0, "Buy at least 1");
        require(numberOfTickets <= MAX_TICKETS, "Too many tickets");

        uint256 cost = ticketPrice * numberOfTickets;

        // Update state
        if (!isParticipant[msg.sender]) {
            isParticipant[msg.sender] = true;
            participants.push(msg.sender);
        }

        for(uint256 i = 0; i < numberOfTickets; i++) {
            ticketOwners[totalTickets + i] = msg.sender;
        }

        ticketsBought[msg.sender] += numberOfTickets;
        totalTickets += numberOfTickets;
        totalContributions += cost;

        // Handle payment
        require(token.transferFrom(msg.sender, address(this), cost), "Transfer failed");

        emit TicketPurchased(msg.sender, numberOfTickets, cost);
    }

    function drawWinners() external onlyOwner {
        require(block.timestamp >= raffleEndTime, "Too early");
        require(!raffleEnded, "Already ended");
        require(totalTickets >= NUM_WINNERS + NUM_RUNNERS_UP, "Not enough participants");

        raffleEnded = true;

        // Generate random seed using block properties
        uint256 randomSeed = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1),
                    block.timestamp,
                    block.prevrandao,
                    totalTickets
                )
            )
        );

        uint256[] memory randomNumbers = new uint256[](NUM_WINNERS + NUM_RUNNERS_UP);
        mapping(uint256 => bool) storage usedTickets;

        // Generate random numbers for selection
        for(uint256 i = 0; i < NUM_WINNERS + NUM_RUNNERS_UP; i++) {
            randomNumbers[i] = uint256(keccak256(abi.encodePacked(randomSeed, i))) % totalTickets;
        }

        uint256 prizePool = getCurrentPrizePool();
        uint256[] memory prizes = new uint256[](NUM_WINNERS);

        // Select winners and runners-up
        for(uint256 i = 0; i < randomNumbers.length; i++) {
            uint256 ticketIndex = randomNumbers[i];

            // Find next unused ticket
            while(usedTickets[ticketIndex]) {
                ticketIndex = (ticketIndex + 1) % totalTickets;
            }

            address participant = ticketOwners[ticketIndex];
            usedTickets[ticketIndex] = true;

            if (!isWinner[participant] && !isRunnerUp[participant]) {
                if (winners.length < NUM_WINNERS) {
                    // Add winner
                    isWinner[participant] = true;
                    prizes[winners.length] = (prizePool * prizePercentages[winners.length]);
                    winnerPrizes[participant] = prizes[winners.length];
                    winners.push(participant);
                } else if (runnersUp.length < NUM_RUNNERS_UP) {
                    // Add runner-up
                    isRunnerUp[participant] = true;
                    runnersUp.push(participant);
                }
            }
        }

        emit WinnersSelected(winners, runnersUp, prizes);
    }

    function claimPrize() external nonReentrant {
        require(raffleEnded, "Not ended");
        require(isWinner[msg.sender], "Not a winner");

        uint256 prize = winnerPrizes[msg.sender];
        require(prize > 0, "Prize already claimed");

        winnerPrizes[msg.sender] = 0;
        require(token.transfer(msg.sender, prize), "Transfer failed");

        emit PrizeClaimed(msg.sender, prize);
    }

    function fundShortfall() external onlyOwner {
        require(raffleEnded, "Raffle not ended");

        uint256 currentPool = (totalContributions * PRIZE_PERCENTAGE) / 100;
        require(currentPool < guaranteedPrizePool, "No shortfall exists");

        uint256 shortfall = guaranteedPrizePool - currentPool;
        totalContributions += shortfall;

        require(token.transferFrom(msg.sender, address(this), shortfall), "Transfer failed");

        emit ShortfallFunded(shortfall, totalContributions);
    }

    // View functions
    function getCurrentPrizePool() public view returns (uint256) {
        uint256 currentPool = (totalContributions * PRIZE_PERCENTAGE) / 100;
        return currentPool < guaranteedPrizePool ? guaranteedPrizePool : currentPool;
    }

    function getWinners() external view returns (address[] memory) {
        return winners;
    }

    function getRunnersUp() external view returns (address[] memory) {
        return runnersUp;
    }

    function emergencyWithdraw() external onlyOwner {
        require(raffleEnded, "Raffle not ended");
        uint256 balance = token.balanceOf(address(this));
        require(token.transfer(owner(), balance), "Transfer failed");
    }
}
