const { ethers, upgrades } = require("hardhat");

const PROXY_ADDRESS = "0x6b4cAc0DcbdBf8518E4B632f698cF6915472917c";

async function main() {
	const RaffleFactory = await ethers.getContractFactory("RaffleFactory");

	console.log("Upgrading RaffleFactory...");

	await upgrades.validateUpgrade(PROXY_ADDRESS, RaffleFactory, {
		kind: "uups",
	});

	const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, RaffleFactory);
	await upgraded.waitForDeployment();

	console.log("RaffleFactory upgraded successfully");
	console.log("Proxy address:", PROXY_ADDRESS);
	console.log("New implementation address:", await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
