const { ethers } = require("hardhat");
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// PostgreSQL connection
const pool = new Pool({
	connectionString: 'postgres://admin:zT9pQj2mKfLn7RxVbNhY5uEw@143.198.240.80:5432/tai-gift'
});

// Draw configurations
const DRAW_CONFIGS = {
	daily: {
		name: "Daily Draw",
		ticketPrice: ethers.parseEther("2"),
		guaranteedPrize: ethers.parseEther("100"),
		durationInHours: 24,
		minTickets: 1,
		maxTicketsPerUser: 10,
		delayInMinutes: 1, // Starts after 1 minute
		type: "DAILY",
		tokenAddress: "0x2ec5787C3291DEa27a6C24Ab15963e60Bd7DF7da"
	},
	weekly: {
		name: "Weekly Draw",
		ticketPrice: ethers.parseEther("10"),
		guaranteedPrize: ethers.parseEther("500"),
		durationInHours: 24 * 7,
		minTickets: 1,
		maxTicketsPerUser: 20,
		delayInMinutes: 2, // Starts after 2 minutes
		type: "WEEKLY",
		tokenAddress: "0x2ec5787C3291DEa27a6C24Ab15963e60Bd7DF7da"
	},
	monthly: {
		name: "Monthly Draw",
		ticketPrice: ethers.parseEther("30"),
		guaranteedPrize: ethers.parseEther("1500"),
		durationInHours: 24 * 30,
		minTickets: 1,
		maxTicketsPerUser: 30,
		delayInMinutes: 3, // Starts after 3 minutes
		type: "MONTHLY",
		tokenAddress: "0x2ec5787C3291DEa27a6C24Ab15963e60Bd7DF7da"
	}
};

// Store active draws
const activeDraws = {
	daily: null,
	weekly: null,
	monthly: null
};

// Database operations
async function createDrawInDB(drawData) {
	const client = await pool.connect();
	try {
		const result = await client.query(`
            INSERT INTO draws (
                id, type, address, "onChainId", "guaranteedPrize", "ticketPrice",
                "startTime", "endTime", "charityWallet", "managementWallet",
                "minTickets", "maxTicketsPerUser", "currentPrizePool", "isActive",
                    "createdAt", "updatedAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
            RETURNING id
        `, [
			uuidv4(),
			drawData.type,
			drawData.address,
			drawData.onChainId,
			drawData.guaranteedPrize.toString(),
			drawData.ticketPrice.toString(),
			drawData.startTime.toString(),
			drawData.endTime.toString(),
			drawData.charityWallet,
			drawData.managementWallet,
			drawData.minTickets.toString(),
			drawData.maxTicketsPerUser.toString(),
			'0',
			true
		]);
		return result.rows[0].id;
	} finally {
		client.release();
	}
}

async function updateDrawStatus(drawId, status) {
	const client = await pool.connect();
	try {
		await client.query(`
            UPDATE draws 
            SET "isActive" = $1, "isComplete" = $2, "currentPrizePool" = $3, "updatedAt" = NOW()
            WHERE id = $4
        `, [status.isActive, status.isComplete, status.currentPrizePool.toString(), drawId]);
	} finally {
		client.release();
	}
}

async function storeWinnersAndAlmostWinners(drawId, winners, prizes, almostWinners) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		// Store winners
		for (let i = 0; i < winners.length; i++) {
			if (winners[i] !== "0x0000000000000000000000000000000000000000") {
				// First ensure account exists
				const accountResult = await client.query(`
                    INSERT INTO accounts (id, address)
                    VALUES ($1, $2)
                    ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
                    RETURNING id
                `, [uuidv4(), winners[i].toLowerCase()]);

				// Then store winner
				await client.query(`
                    INSERT INTO winners (id, position, prize, "drawId", "accountId")
                    VALUES ($1, $2, $3, $4, $5)
                `, [
					uuidv4(),
					i,
					prizes[i].toString(),
					drawId,
					accountResult.rows[0].id
				]);
			}
		}

		// Store almost winners with zero prize
		for (let i = 0; i < almostWinners.length; i++) {
			if (almostWinners[i] !== "0x0000000000000000000000000000000000000000") {
				// Ensure account exists
				const accountResult = await client.query(`
                    INSERT INTO accounts (id, address)
                    VALUES ($1, $2)
                    ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
                    RETURNING id
                `, [uuidv4(), almostWinners[i].toLowerCase()]);

				// Store almost winner with position after winners
				await client.query(`
                    INSERT INTO winners (id, position, prize, "drawId", "accountId")
                    VALUES ($1, $2, $3, $4, $5)
                `, [
					uuidv4(),
					winners.length + i,
					'0',
					drawId,
					accountResult.rows[0].id
				]);
			}
		}

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

async function createDraw(factory, drawType, baseStartTime) {
	const config = DRAW_CONFIGS[drawType];

	// Calculate staggered start and end times
	const startTime = baseStartTime + (config.delayInMinutes * 60);
	const endTime = startTime + (config.durationInHours * 3600);

	const raffleConfig = {
		guaranteedPrize: config.guaranteedPrize,
		ticketPrice: config.ticketPrice,
		startTime: startTime,
		endTime: endTime,
		charityWallet: "0x44FcF345A55ab1256Cf2A889BB35B352E3eF53B9",
		managementWallet: "0xcc49f624f003E56A1eB30d18084233Dd68d2B6CE",
		minTickets: config.minTickets,
		maxTicketsPerUser: config.maxTicketsPerUser,
		tokenAddress: "0x2ec5787C3291DEa27a6C24Ab15963e60Bd7DF7da"
	};

	try {
		console.log(`\nCreating ${config.name}...`);
		console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()}`);
		console.log(`End Time: ${new Date(endTime * 1000).toLocaleString()}`);

		// Get predicted address
		const drawCount = await factory.drawCount();
		const predictedAddress = await factory.getPredictedAddress(drawCount, raffleConfig);
		console.log(`Predicted Address: ${predictedAddress}`);

		const tx = await factory.createDraw(raffleConfig, { gasLimit: 3000000 });
		await tx.wait(1);

		const drawId = await factory.drawCount() - 1n;
		const drawAddress = await factory.getDrawAddress(drawId);
		const raffle = await ethers.getContractAt("Raffle", drawAddress);

		console.log(`${config.name} created successfully:`);
		console.log(`- Draw ID: ${drawId}`);
		console.log(`- Address: ${drawAddress}`);
		console.log(`- Start: ${new Date(startTime * 1000).toLocaleString()}`);
		console.log(`- End: ${new Date(endTime * 1000).toLocaleString()}`);
		console.log(`- Prize Pool: ${ethers.formatEther(config.guaranteedPrize)} TAIKO`);
		console.log(`- Ticket Price: ${ethers.formatEther(config.ticketPrice)} TAIKO`);


		const dbDrawId = await createDrawInDB({
			type: DRAW_CONFIGS[drawType].type,
			address: drawAddress,
			onChainId: Number(drawId),
			guaranteedPrize: raffleConfig.guaranteedPrize,
			ticketPrice: raffleConfig.ticketPrice,
			startTime: raffleConfig.startTime,
			endTime: raffleConfig.endTime,
			charityWallet: raffleConfig.charityWallet,
			managementWallet: raffleConfig.managementWallet,
			minTickets: raffleConfig.minTickets,
			maxTicketsPerUser: raffleConfig.maxTicketsPerUser
		});

		return {
			type: drawType,
			id: drawId,
			address: drawAddress,
			contract: raffle,
			startTime,
			endTime,
			config: raffleConfig,
			dbId: dbDrawId,
		};
	} catch (error) {
		console.error(`Error creating ${config.name}:`, error);
		throw error;
	}
}

async function startDraw(factory, draw) {
	try {
		const raffle = draw.contract;
		console.log(`\nStarting ${DRAW_CONFIGS[draw.type].name} (ID: ${draw.id})...`);
		const tx = await factory.startDraw(draw.id, { gasLimit: 2000000 });
		await tx.wait(1);
		console.log(`${DRAW_CONFIGS[draw.type].name} started successfully!`);

		// Get and log initial status
		const status = await raffle.getStatus();
		await updateDrawStatus(draw.dbId, status);

		console.log(`Status:
- Is Active: ${status.isActive}
- Current Prize Pool: ${ethers.formatEther(status.currentPrizePool)} TAIKO
- Total Tickets: ${status.totalTickets}`);
	} catch (error) {
		console.error(`Error starting draw:`, error);
		throw error;
	}
}

async function completeDraw(factory, draw) {
	try {
		// Check if shortfall funding is needed
		const raffle = draw.contract;
		const status = await raffle.getStatus();
		const config = await raffle.getConfig();

		if (!status.isComplete) {
			// Check for shortfall
			if (config.guaranteedPrize > status.currentPrizePool) {
				console.log(`\nFunding shortfall for ${DRAW_CONFIGS[draw.type].name} (ID: ${draw.id})...`);
				const shortfall = config.guaranteedPrize - status.currentPrizePool;
				await factory.fundDrawShortfall(draw.id, { value: shortfall, gasLimit: 2000000 });
				console.log(`Shortfall funded: ${ethers.formatEther(shortfall)} TAIKO`);
			}

			// Complete the draw
			console.log(`\nCompleting ${DRAW_CONFIGS[draw.type].name} (ID: ${draw.id})...`);
			const tx = await factory.completeDraw(draw.id, { gasLimit: 3000000 });
			await tx.wait(1);
			console.log(`${DRAW_CONFIGS[draw.type].name} completed successfully!`);

			// Log winners
			const [winners, prizes] = await raffle.getWinnersAndPrizes();
			console.log("\nWinners:");
			winners.forEach((winner, index) => {
				if (winner !== "0x0000000000000000000000000000000000000000") {
					console.log(`${index + 1}. ${winner}: ${ethers.formatEther(prizes[index])} TAIKO`);
				}
			});

			const almostWinners = await raffle.getAlmostWinners();
			await storeWinnersAndAlmostWinners(draw.dbId, winners, prizes, almostWinners);

			// Update draw status
			const status = await raffle.getStatus();
			await updateDrawStatus(draw.dbId, status);
		}
	} catch (error) {
		console.error(`Error completing draw:`, error);
		throw error;
	}
}

async function monitorAndManageDraws(factory) {
	while (true) {
		const currentBlock = await ethers.provider.getBlock('latest');
		const currentTime = currentBlock.timestamp;

		// Check each active draw
		for (const [drawType, draw] of Object.entries(activeDraws)) {
			if (draw) {
				// If draw has ended
				if (currentTime >= draw.endTime) {
					try {
						// Complete current draw
						await completeDraw(factory, draw);

						// Create and start next draw
						const nextStartTime = currentTime + (DRAW_CONFIGS[drawType].delayInMinutes * 60);
						const nextDraw = await createDraw(factory, drawType, nextStartTime);

						// Wait for start time
						const waitTime = (nextStartTime - currentTime) * 1000;
						if (waitTime > 0) {
							console.log(`Waiting ${waitTime/1000} seconds to start next ${drawType} draw...`);
							await new Promise(resolve => setTimeout(resolve, waitTime));
						}

						// Start new draw
						await startDraw(factory, nextDraw);
						activeDraws[drawType] = nextDraw;
					} catch (error) {
						console.error(`Error managing ${drawType} draw cycle:`, error);
					}
				}
			}
		}

		// Wait for 5 minutes before next check
		await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
	}
}

async function main() {
	const [deployer] = await ethers.getSigners();
	console.log("Managing draws with account:", deployer.address);

	const FACTORY_ADDRESS = "0x6b4cAc0DcbdBf8518E4B632f698cF6915472917c";
	const factory = await ethers.getContractAt("RaffleFactory", FACTORY_ADDRESS);
	console.log("Using RaffleFactory at:", factory.target);

	// Get current timestamp
	const currentBlock = await ethers.provider.getBlock('latest');
	const baseStartTime = currentBlock.timestamp;

	// Create initial draws with staggered start times
	for (const drawType of Object.keys(DRAW_CONFIGS)) {
		try {
			console.log(`\nCreating ${DRAW_CONFIGS[drawType].name}...`);
			const draw = await createDraw(factory, drawType, baseStartTime);
			activeDraws[drawType] = draw;

			// Wait between draw creations
			await new Promise(resolve => setTimeout(resolve, 5000));
		} catch (error) {
			console.error(`Error in initial ${drawType} draw creation:`, error);
		}
	}

	// Start each draw when its time comes
	for (const [drawType, draw] of Object.entries(activeDraws)) {
		if (draw) {
			const waitTime = (draw.startTime - currentBlock.timestamp) * 1000;
			if (waitTime > 0) {
				console.log(`\nWaiting ${waitTime/1000} seconds to start ${DRAW_CONFIGS[drawType].name}...`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
			}
			await startDraw(factory, draw);
		}
	}

	// Start monitoring and managing draws
	await monitorAndManageDraws(factory);
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
