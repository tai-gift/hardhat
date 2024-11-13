import {ethers, upgrades} from "hardhat";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {Raffle, RaffleFactory} from "../typechain-types";

describe("Raffle", function () {
  // Test fixture that deploys all contracts
  async function deployRaffleFixture() {
    const [owner, charity, management, user1, user2, user3, user4] = await ethers.getSigners();

    // Deploy factory
    const RaffleFactory = await ethers.getContractFactory("RaffleFactory");
    const factory = await upgrades.deployProxy(RaffleFactory, [], {kind: 'uups'}) as unknown as RaffleFactory;
    await factory.waitForDeployment();

    // Setup draw config
    const startTime = await time.latest() + 3600; // Start in 1 hour
    const endTime = startTime + 86400; // End in 24 hours
    const config = {
      guaranteedPrize: ethers.parseEther("10"),
      ticketPrice: ethers.parseEther("0.1"),
      startTime: startTime,
      endTime: endTime,
      charityWallet: charity.address,
      managementWallet: management.address,
      minTickets: 50,
      maxTicketsPerUser: 5
    };

    // Create draw
    const tx = await factory.createDraw(config);
    await tx.wait();

    const count: bigint = await factory.drawCount();
    const drawAddress = await  factory.draws((count - BigInt(1))?.toString());

    const raffle = await ethers.getContractAt("Raffle", drawAddress) as unknown as Raffle;

    return {
      factory,
      raffle,
      config,
      owner,
      charity,
      management,
      user1,
      user2,
      user3,
      user4
    };
  }

  describe("Factory Operations", function () {
    it("Should not allow non-owner to create draw", async function () {
      const { factory, user1, config } = await loadFixture(deployRaffleFixture);
      await expect(
        factory.connect(user1).createDraw(config)
      ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
    });

    it("Should not create draw with invalid time configuration", async function () {
      const { factory, config } = await loadFixture(deployRaffleFixture);
      const invalidConfig = {
        ...config,
        startTime: config.endTime,
        endTime: config.startTime
      };
      await expect(
        factory.createDraw(invalidConfig)
      ).to.be.revertedWith("Invalid end time");
    });

    it("Should predict draw address correctly", async function () {
      const { factory, config } = await loadFixture(deployRaffleFixture);
      const drawId = await factory.drawCount();
      const predictedAddress = await factory.getPredictedAddress(drawId, config);

      const tx = await factory.createDraw(config);
      await tx.wait();

      const actualAddress = await factory.getDrawAddress(drawId);
      expect(actualAddress).to.equal(predictedAddress);
    });
  });

  describe("Draw Management", function () {
    it("Should not allow non-owner to start draw", async function () {
      const { factory, user1 } = await loadFixture(deployRaffleFixture);
      await expect(
        factory.connect(user1).startDraw(0)
      ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
    });

    it("Should not start draw before start time", async function () {
      const { factory, config } = await loadFixture(deployRaffleFixture);
      await expect(
        factory.startDraw(0)
      ).to.be.revertedWith("Start time not reached yet");
    });

    it("Should not allow starting already active draw", async function () {
      const { factory, config } = await loadFixture(deployRaffleFixture);
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);

      await expect(
        factory.startDraw(0)
      ).to.be.revertedWith("Draw already active");
    });
  });

  describe("Ticket Purchase Validations", function () {
    it("Should reject purchase with insufficient payment", async function () {
      const { raffle, factory, user1, config } = await loadFixture(deployRaffleFixture);
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);

      const insufficientAmount = ethers.parseEther("0.05"); // Half of ticket price
      await expect(
        raffle.connect(user1).buyTickets({ value: insufficientAmount })
      ).to.be.revertedWith("Invalid ticket amount");
    });

    it("Should reject purchase after end time", async function () {
      const { raffle, factory, user1, config } = await loadFixture(deployRaffleFixture);
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);
      await time.increaseTo(config.endTime + 1);

      await expect(
        raffle.connect(user1).buyTickets({
          value: ethers.parseEther("0.1")
        })
      ).to.be.revertedWith("Not within draw period");
    });

    it("Should track participants correctly", async function () {
      const { raffle, factory, user1, user2, config } = await loadFixture(deployRaffleFixture);
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);

      await raffle.connect(user1).buyTickets({ value: ethers.parseEther("0.2") }); // 2 tickets
      await raffle.connect(user2).buyTickets({ value: ethers.parseEther("0.1") }); // 1 ticket

      const status = await raffle.status();
      expect(status.totalTickets).to.equal(3);
    });
  });

  describe("Prize Claims", function () {
    it("Should not allow claiming before draw completion", async function () {
      const { raffle, factory, user1, config } = await loadFixture(deployRaffleFixture);
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);

      await expect(
        raffle.connect(user1).claimPrize()
      ).to.be.revertedWith("Draw not complete");
    });

    it("Should not allow double claiming", async function () {
      const { raffle, factory, user1, config } = await loadFixture(deployRaffleFixture);

      // Setup and complete draw
      await time.increaseTo(config.startTime);
      await factory.startDraw(0);
      await raffle.connect(user1).buyTickets({ value: ethers.parseEther("0.5") });
      await time.increaseTo(config.endTime);

      // Fund factory
      await ethers.provider.send("eth_sendTransaction", [{
        from: await user1.getAddress(),
        to: factory.target,
        value: ethers.parseEther("100")?.toString()
      }]);

      await factory.fundDrawShortfall(0);

      await factory.completeDraw(0);

      // Try to claim twice if winner
      const [winners] = await raffle.getWinnersAndPrizes();
      if (winners.includes(user1.address)) {
        await raffle.connect(user1).claimPrize();
        await expect(
          raffle.connect(user1).claimPrize()
        ).to.be.revertedWith("Already claimed");
      }
    });

    it("Should not allow non-winners to claim", async function () {
      const { raffle, factory, user1, user2, config } = await loadFixture(deployRaffleFixture);

      await time.increaseTo(config.startTime);
      await factory.startDraw(0);
      await raffle.connect(user1).buyTickets({ value: ethers.parseEther("0.2") });
      await time.increaseTo(config.endTime);

      // Fund factory
      await ethers.provider.send("eth_sendTransaction", [{
        from: await user1.getAddress(),
        to: factory.target,
        value: ethers.parseEther("100")?.toString()
      }]);

      await factory.fundDrawShortfall(0)

      await factory.completeDraw(0);

      // Attempt claim from non-participant
      await expect(
        raffle.connect(user2).claimPrize()
      ).to.be.revertedWith("No prize available");
    });
  });

  describe("Factory Insurance Fund", function () {
    it("Should handle shortfall funding correctly", async function () {
      const { factory, raffle, config, user1 } = await loadFixture(deployRaffleFixture);

      await time.increaseTo(config.startTime);
      await factory.startDraw(0);

      // Buy minimal tickets
      await raffle.connect(user1).buyTickets({ value: ethers.parseEther("0.2") });

      await time.increaseTo(config.endTime);

      // Fund factory
      const fundAmount = ethers.parseEther("60");
      await ethers.provider.send("eth_sendTransaction", [{
        from: await user1.getAddress(),
        to: factory.target,
        value: fundAmount?.toString()
      }]);

      const balanceBefore = await ethers.provider.getBalance(raffle.target);
      await factory.fundDrawShortfall(0);
      const balanceAfter = await ethers.provider.getBalance(raffle.target);

      // Verify shortfall was covered
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });
});
