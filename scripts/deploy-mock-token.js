// deploy.ts
const { ethers, upgrades } = require("hardhat");

async function main() {
	// Deploy Mock Token
	const MockTaikoToken = await ethers.getContractFactory("MockTaikoToken");
	const mockToken = await MockTaikoToken.deploy();
	await mockToken.waitForDeployment();
	console.log("Mock Taiko Token deployed to:", await mockToken.getAddress());
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
