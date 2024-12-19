// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RaffleNotifications
 * @dev Central contract for tracking all raffle events for easy subgraph indexing
 */
contract RaffleNotifications is Ownable {
    // State variables
    address public factory;
    bool public factoryIsSet;

    // Events for subgraph indexing
    event RaffleCreated(
        address indexed raffleAddress,
        address indexed creator,
        address tokenAddress,
        uint256 ticketPrice,
        uint256 duration,
        uint256 guaranteedPrize,
        uint256 timestamp
    );

    event RaffleEnded(
        address indexed raffleAddress,
        uint256 totalParticipants,
        uint256 totalTickets,
        uint256 finalPrizePool,
        uint256 timestamp
    );

    event WinnersDrawn(
        address indexed raffleAddress,
        address[] winners,
        address[] runnersUp,
        uint256[] prizes,
        uint256 timestamp
    );

    event TicketsBought(
        address indexed raffleAddress,
        address indexed buyer,
        uint256 numberOfTickets,
        uint256 totalCost,
        uint256 timestamp
    );

    event PrizeClaimed(
        address indexed raffleAddress,
        address indexed winner,
        uint256 amount,
        uint256 timestamp
    );

    event ContributionRefunded(
        address indexed raffleAddress,
        address indexed participant,
        uint256 amount,
        uint256 timestamp
    );

    event FactorySet(address indexed oldFactory, address indexed newFactory);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory can call this");
        _;
    }


    constructor() Ownable(msg.sender) {}



    /**
     * @notice Set the factory address
     * @dev Can only be called once by the owner
     */
    function setFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Invalid factory address");
        require(!factoryIsSet, "Factory already set");

        factory = _factory;
        factoryIsSet = true;

        emit FactorySet(address(0), _factory);
    }

    // Notification functions called by the Raffle contract
    function notifyRaffleCreated(
        address raffleAddress,
        address creator,
        address tokenAddress,
        uint256 ticketPrice,
        uint256 duration,
        uint256 guaranteedPrize
    ) external onlyFactory {
        emit RaffleCreated(
            raffleAddress,
            creator,
            tokenAddress,
            ticketPrice,
            duration,
            guaranteedPrize,
            block.timestamp
        );
    }

    function notifyRaffleEnded(
        address raffleAddress,
        uint256 totalParticipants,
        uint256 totalTickets,
        uint256 finalPrizePool
    ) external {
        require(msg.sender == raffleAddress, "Only raffle can notify");
        emit RaffleEnded(
            raffleAddress,
            totalParticipants,
            totalTickets,
            finalPrizePool,
            block.timestamp
        );
    }

    function notifyWinnersDrawn(
        address raffleAddress,
        address[] calldata winners,
        address[] calldata runnersUp,
        uint256[] calldata prizes
    ) external {
        require(msg.sender == raffleAddress, "Only raffle can notify");
        emit WinnersDrawn(
            raffleAddress,
            winners,
            runnersUp,
            prizes,
            block.timestamp
        );
    }

    function notifyTicketsBought(
        address raffleAddress,
        address buyer,
        uint256 numberOfTickets,
        uint256 totalCost
    ) external {
        require(msg.sender == raffleAddress, "Only raffle can notify");
        emit TicketsBought(
            raffleAddress,
            buyer,
            numberOfTickets,
            totalCost,
            block.timestamp
        );
    }

    function notifyPrizeClaimed(
        address raffleAddress,
        address winner,
        uint256 amount
    ) external {
        require(msg.sender == raffleAddress, "Only raffle can notify");
        emit PrizeClaimed(
            raffleAddress,
            winner,
            amount,
            block.timestamp
        );
    }

    function notifyContributionRefunded(
        address raffleAddress,
        address participant,
        uint256 amount
    ) external {
        require(msg.sender == raffleAddress, "Only raffle can notify");
        emit ContributionRefunded(
            raffleAddress,
            participant,
            amount,
            block.timestamp
        );
    }
}

interface IRaffleNotifications {
    function notifyRaffleEnded(
        address raffleAddress,
        uint256 totalParticipants,
        uint256 totalTickets,
        uint256 finalPrizePool
    ) external;

    function notifyWinnersDrawn(
        address raffleAddress,
        address[] calldata winners,
        address[] calldata runnersUp,
        uint256[] calldata prizes
    ) external;

    function notifyTicketsBought(
        address raffleAddress,
        address buyer,
        uint256 numberOfTickets,
        uint256 totalCost
    ) external;

    function notifyPrizeClaimed(
        address raffleAddress,
        address winner,
        uint256 amount
    ) external;

    function notifyContributionRefunded(
        address raffleAddress,
        address participant,
        uint256 amount
    ) external;
}
