// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./RaffleFactory.sol";
import "./RaffleLib.sol";

// Individual Draw Contract
contract Raffle is ReentrancyGuard, Ownable {
    uint256 private constant WINNERS_COUNT = 10;
    uint256 private constant WINNER_POOL_PERCENTAGE = 40;
    uint256 private constant CHARITY_PERCENTAGE = 50;
    uint256 private constant BONUS_PERCENTAGE = 5;
    uint256 private constant MANAGEMENT_PERCENTAGE = 15;
    uint256 private constant MAX_SELECTION_ATTEMPTS = 50;

    address public factory;
    RaffleLib.DrawConfig public config;
    RaffleLib.DrawStatus public status;

    mapping(address => uint256) public tickets;
    mapping(address => bool) public hasClaimed;
    mapping(address => bool) internal selectedWinners;

    address[] public participants;
    address[] public winners;
    address[] public almostWinners;
    uint256[] public prizes;

    uint256[10] private winnerPercentages = [30, 25, 15, 7, 7, 5, 5, 2, 2, 2];

    event TicketsPurchased(address indexed buyer, uint256 tickets, uint256 amount);
    event PrizeClaimed(address indexed winner, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory can call this function");
        _;
    }

    modifier onlyDuring() {
        require(block.timestamp >= config.startTime && block.timestamp < config.endTime, "Not within draw period");
        require(status.isActive && !status.isComplete, "Draw not active or already complete");
        _;
    }


    constructor(address _factory, RaffleLib.DrawConfig memory _config) Ownable(msg.sender) ReentrancyGuard() {
        factory = _factory;
        config = _config;
    }

    function startDraw() external onlyFactory {
        require(!status.isActive, "Draw already active");
        require(block.timestamp >= config.startTime, "Start time not reached yet");
        status.isActive = true;
    }

    function buyTickets() external payable nonReentrant onlyDuring {
        uint256 numOfTickets = msg.value / config.ticketPrice;
        require(numOfTickets > 0, "Invalid ticket amount");
        require(numOfTickets < 10, "Max 10 tickets per transaction");
        require(tickets[msg.sender] + numOfTickets <= config.maxTicketsPerUser, "Ticket limit exceeded");

        for (uint256 i = 0; i < numOfTickets; i++) {
            participants.push(msg.sender);
        }

        tickets[msg.sender] += numOfTickets;
        status.totalTickets += numOfTickets;
        status.currentPrizePool += msg.value;

        RaffleFactory(payable(factory)).notifyTicketPurchase(msg.sender, numOfTickets, msg.value);

        emit TicketsPurchased(msg.sender, numOfTickets, msg.value);
    }

    function getEndTime() external view returns (uint256) {
        return config.endTime;
    }

    function completeDraw() external nonReentrant returns(RaffleLib.DrawStatus memory) {
        require(block.timestamp >= config.endTime, "Draw still ongoing");
        require(!status.isComplete, "Draw already complete");

        if (config.guaranteedPrize > status.currentPrizePool && config.guaranteedPrize <= address(this).balance) {
            status.currentPrizePool = config.guaranteedPrize;
        }

        require(config.guaranteedPrize <= status.currentPrizePool, "Shortfall funding required");

        winners = new address[](WINNERS_COUNT);
        prizes = new uint256[](WINNERS_COUNT);
        almostWinners = new address[](5);

        uint256 winnerPool = (status.currentPrizePool * WINNER_POOL_PERCENTAGE) / 100;
        uint256 charityAmount = (status.currentPrizePool * CHARITY_PERCENTAGE) / 100;
        uint256 managementAmount = (status.currentPrizePool * MANAGEMENT_PERCENTAGE) / 100;

        for (uint256 i = 0; i < WINNERS_COUNT; i++) {
            prizes[i] = (winnerPool * winnerPercentages[i]) / 100;
        }

        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao)));
        (address[] memory selectedWinners, address[] memory selectedAlmostWinners) = selectWinners(seed);

        // Set winners and almost winners
        winners = selectedWinners;
        almostWinners = selectedAlmostWinners;

        (bool charitySuccess, ) = config.charityWallet.call{value: charityAmount}("");
        require(charitySuccess, "Charity transfer failed");

        (bool managementSuccess, ) = config.managementWallet.call{value: managementAmount}("");
        require(managementSuccess, "Management transfer failed");

        status.isComplete = true;

        return status;
    }

    function selectWinners(uint256 seed) private returns (address[] memory, address[] memory) {
        address[] memory tempWinners = new address[](WINNERS_COUNT);
        address[] memory tempAlmostWinners = new address[](5);
        uint256 winnerCount = 0;
        uint256 almostWinnerCount = 0;
        uint256 attempts = 0;

        require(participants.length > 0, "No participants");

        while ((winnerCount < WINNERS_COUNT || almostWinnerCount < 5) && attempts < MAX_SELECTION_ATTEMPTS) {
            uint256 winnerIndex = uint256(keccak256(abi.encodePacked(seed, attempts))) % participants.length;
            address candidate = participants[winnerIndex];

            if (!selectedWinners[candidate]) {
                selectedWinners[candidate] = true;

                if (winnerCount < WINNERS_COUNT) {
                    tempWinners[winnerCount] = candidate;
                    winnerCount++;
                } else if (almostWinnerCount < 5) {
                    tempAlmostWinners[almostWinnerCount] = candidate;
                    almostWinnerCount++;
                }
            }
            attempts++;
        }

        // Fill any remaining slots with zero address if we couldn't find enough unique winners
        for (uint256 i = winnerCount; i < WINNERS_COUNT; i++) {
            tempWinners[i] = address(0);
        }
        for (uint256 i = almostWinnerCount; i < 5; i++) {
            tempAlmostWinners[i] = address(0);
        }

        return (tempWinners, tempAlmostWinners);
    }

    function claimPrize() external nonReentrant {
        require(status.isComplete, "Draw not complete");
        require(!hasClaimed[msg.sender], "Already claimed");

        uint256 prize = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == msg.sender) {
                prize = prizes[i];
                break;
            }
        }

        require(prize > 0, "No prize available");

        hasClaimed[msg.sender] = true;
        (bool success, ) = msg.sender.call{value: prize}("");
        require(success, "Prize claim failed");

        emit PrizeClaimed(msg.sender, prize);
    }

    function getConfig() external view returns (RaffleLib.DrawConfig memory) {
        return config;
    }

    function getStatus() external view returns (RaffleLib.DrawStatus memory) {
        return status;
    }

    function getParticipants() external view returns (address[] memory) {
        return participants;
    }

    function getWinnersAndPrizes() external view returns (address[] memory, uint256[] memory) {
        return (winners, prizes);
    }

    function getAlmostWinners() external view returns (address[] memory) {
        return almostWinners;
    }

    // To handle receiving Ether, use a receive function
    receive() external payable {}

    // Or to handle any unexpected function calls, use a fallback
    fallback() external payable {}
}
