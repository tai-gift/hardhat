const { ethers, upgrades } = require("hardhat");

async function main() {
	// Compile contracts
	await hre.run("compile");

	// Deploy RaffleFactory as an upgradeable contract
	const RaffleFactory = await ethers.getContractFactory("RaffleFactory");
	console.log("Deploying RaffleFactory...");

	const raffleFactory = await upgrades.deployProxy(RaffleFactory, [], {
		initializer: "initialize",
	});
	await raffleFactory.waitForDeployment();

	console.log("RaffleFactory deployed to:", raffleFactory.target);

	// // Verify contract on Taiko if needed (requires API keys)
	// await hre.run("verify:verify", {
	//   address: raffleFactory.target,
	//   constructorArguments: [],
	// });

	console.log("RaffleFactory deployed and initialized on Taiko testnet!");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
