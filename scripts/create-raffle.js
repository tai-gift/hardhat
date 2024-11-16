const { ethers } = require("hardhat");

async function main() {
	const [deployer] = await ethers.getSigners();
	console.log("Creating daily TAIKO raffle with account:", deployer.address);

	// Factory address
	const FACTORY_ADDRESS = "0x6b4cAc0DcbdBf8518E4B632f698cF6915472917c";

	// Get the RaffleFactory contract instance
	const factory = await ethers.getContractAt("RaffleFactory", FACTORY_ADDRESS);
	console.log("Using RaffleFactory at:", factory.target);

	// Get current timestamp
	const latestBlock = await ethers.provider.getBlock('latest');
	const currentTimestamp = latestBlock.timestamp;
	console.log("Current timestamp:", currentTimestamp);

	// Set start time to be current block timestamp + 60 seconds
	const startTime = currentTimestamp + 60; // 1 minute from now
	const endTime = startTime + (24 * 60 * 60); // 24 hours after start time

	console.log("Start time:", new Date(startTime * 1000).toLocaleString());
	console.log("End time:", new Date(endTime * 1000).toLocaleString());

	// Configure the daily raffle
	const raffleConfig = {
		guaranteedPrize: ethers.parseEther("100"), // 100 TAIKO
		ticketPrice: ethers.parseEther("2"), // 2 TAIKO
		startTime: startTime,
		endTime: endTime,
		charityWallet: "0x44FcF345A55ab1256Cf2A889BB35B352E3eF53B9",
		managementWallet: "0xcc49f624f003E56A1eB30d18084233Dd68d2B6CE",
		minTickets: 1,
		maxTicketsPerUser: 10
	};

	try {
		// Create transaction with explicit gas limit
		console.log("\nCreating daily TAIKO raffle...");
		const tx = await factory.createDraw(
			raffleConfig,
			{
				gasLimit: 3000000,
			}
		);

		console.log("Transaction hash:", tx.hash);
		console.log("Waiting for transaction confirmation...");

		const receipt = await tx.wait(1);
		console.log("Transaction confirmed in block:", receipt.blockNumber);

		// Get the draw ID from the drawCount
		const drawId = await factory.drawCount() - 1n;
		console.log("New Draw ID:", drawId.toString());

		// Get the draw address
		const drawAddress = await factory.getDrawAddress(drawId);
		console.log("Draw address:", drawAddress);

		// Get raffle contract
		const raffle = await ethers.getContractAt("Raffle", drawAddress);

		// Get configuration
		const config = await raffle.getConfig();
		console.log(`
Daily TAIKO Raffle created successfully:
- Draw ID: ${drawId}
- Draw Address: ${drawAddress}
- Configuration:
  • Guaranteed Prize: ${ethers.formatEther(config.guaranteedPrize)} TAIKO ($${ethers.formatEther(config.guaranteedPrize) * 1.5})
  • Ticket Price: ${ethers.formatEther(config.ticketPrice)} TAIKO ($${ethers.formatEther(config.ticketPrice) * 1.5})
  • Start Time: ${new Date(Number(config.startTime) * 1000).toLocaleString()}
  • End Time: ${new Date(Number(config.endTime) * 1000).toLocaleString()}
  • Duration: 24 hours
  • Min Tickets: ${config.minTickets}
  • Max Tickets Per User: ${config.maxTicketsPerUser}
  • Charity Wallet: ${config.charityWallet}
  • Management Wallet: ${config.managementWallet}
        `);

		console.log("\nWaiting for start time...");
		// Wait until start time is reached before starting the raffle
		const waitTime = (startTime - currentTimestamp) * 1000;
		if (waitTime > 0) {
			console.log(`Waiting ${waitTime/1000} seconds for start time...`);
			await new Promise(resolve => setTimeout(resolve, waitTime));
		}

		// Start the draw
		console.log("Starting the daily raffle...");
		const startTx = await factory.startDraw(
			drawId,
			{
				gasLimit: 2000000,
			}
		);
		await startTx.wait(1);
		console.log("Daily raffle started successfully!");

		// Get status
		const status = await raffle.getStatus();
		console.log("\nRaffle Status:");
		console.log("- Is Active:", status.isActive);
		console.log("- Is Complete:", status.isComplete);
		console.log("- Current Prize Pool:", ethers.formatEther(status.currentPrizePool), "TAIKO");
		console.log("- Total Tickets:", status.totalTickets.toString());

	} catch (error) {
		console.error("Error creating raffle:", error);
		if (error.reason) {
			console.error("Error reason:", error.reason);
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
