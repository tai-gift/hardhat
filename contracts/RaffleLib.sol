// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

library RaffleLib {
    struct DrawConfig {
        uint256 guaranteedPrize;
        uint256 ticketPrice;
        uint256 startTime;
        uint256 endTime;
        address payable charityWallet;
        address payable managementWallet;
        uint256 minTickets;
        uint256 maxTicketsPerUser;
    }

    struct DrawStatus {
        uint256 currentPrizePool;
        uint256 totalTickets;
        bool isActive;
        bool isComplete;
    }
}
