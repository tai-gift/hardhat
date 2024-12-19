import { ethers, upgrades } from "hardhat";

const ERC20_TOKEN_ADDRESS = process.env.ERC20_TOKEN_ADDRESS;
const TICKET_PRICE = ethers.parseUnits("10", 18); // 10 tokens
const RAFFLE_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const GUARANTEED_PRIZE_POOL = ethers.parseUnits("1000", 18); // 1000 tokens

async function main() {
  console.log("Starting deployment on Taiko testnet...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  try {
    // 1. Deploy RaffleNotifications
    console.log("\nDeploying RaffleNotifications...");
    const RaffleNotifications = await ethers.getContractFactory("RaffleNotifications");
    const raffleNotifications = await RaffleNotifications.deploy();
    await raffleNotifications.waitForDeployment();
    console.log("RaffleNotifications deployed to:", await raffleNotifications.getAddress());

    // 2. Deploy Raffle Implementation
    console.log("\nDeploying Raffle Implementation...");
    const RaffleContract = await ethers.getContractFactory("Raffle");
    const raffleImpl = await RaffleContract.deploy();
    await raffleImpl.waitForDeployment();
    console.log("Raffle Implementation deployed to:", await raffleImpl.getAddress());

    // 3. Deploy RaffleFactory with UUPS proxy
    console.log("\nDeploying RaffleFactory with proxy...");
    const RaffleFactoryContract = await ethers.getContractFactory("RaffleFactory");
    const raffleFactory = await upgrades.deployProxy(
      RaffleFactoryContract,
      [
        await raffleNotifications.getAddress(),
        await raffleImpl.getAddress(),
      ],
      {
        kind: "uups",
        initializer: "initialize",
      }
    );
    await raffleFactory.waitForDeployment();
    const factoryAddress = await raffleFactory.getAddress();
    console.log("RaffleFactory deployed to:", factoryAddress);

    // 4. Update RaffleNotifications with factory address
    console.log("\nUpdating RaffleNotifications with factory address...");
    const currentFactory = await raffleNotifications.factory();

    if (currentFactory.toLowerCase() !== factoryAddress.toLowerCase()) {
      const tx = await raffleNotifications.setFactory(factoryAddress);
      await tx.wait();
      console.log("RaffleNotifications factory address updated");
    }

    // 5. Deploy first test raffle
    console.log("\nDeploying test raffle...");

    // Predict next raffle address
    const predictedAddress = await raffleFactory.predictNextRaffleAddress(
      deployer.address,
      ERC20_TOKEN_ADDRESS,
      TICKET_PRICE,
      RAFFLE_DURATION,
      GUARANTEED_PRIZE_POOL
    );
    console.log("Predicted raffle address:", predictedAddress);

    // Deploy the raffle
    const tx = await raffleFactory.deployRaffle(
      ERC20_TOKEN_ADDRESS,
      TICKET_PRICE,
      RAFFLE_DURATION,
      GUARANTEED_PRIZE_POOL
    );
    const receipt = await tx.wait();

    // Get deployment info from events
    const deployEvent = receipt?.logs.find((log: any) => {
      try {
        const parsedLog = RaffleFactoryContract.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsedLog?.name === 'RaffleDeployed';
      } catch {
        return false;
      }
    });

    let deployedRaffleAddress;
    if (deployEvent) {
      const parsedEvent = RaffleFactoryContract.interface.parseLog({
        topics: deployEvent.topics,
        data: deployEvent.data,
      });
      deployedRaffleAddress = parsedEvent?.args[0];
      console.log("Actual raffle address:", deployedRaffleAddress);
    }

    // Verify addresses match
    if (deployedRaffleAddress && predictedAddress.toLowerCase() !== deployedRaffleAddress.toLowerCase()) {
      console.warn("Warning: Predicted and actual raffle addresses don't match!");
      console.log("Predicted:", predictedAddress);
      console.log("Actual:", deployedRaffleAddress);
    }

    console.log("\nDeployment complete!");

    // Save deployment info
    const network = await ethers.provider.getNetwork();
    const deploymentInfo = {
      network: network.name,
      chainId: network.chainId,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: {
        raffleNotifications: await raffleNotifications.getAddress(),
        raffleImplementation: await raffleImpl.getAddress(),
        raffleFactory: factoryAddress,
        testRaffle: deployedRaffleAddress || predictedAddress,
      }
    };

    console.log("\nDeployment info:", deploymentInfo);

    return deploymentInfo.contracts;

  } catch (error) {
    console.error("Deployment failed:", error);
    throw error;
  }
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
