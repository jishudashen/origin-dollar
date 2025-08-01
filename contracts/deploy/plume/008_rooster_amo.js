const hre = require("hardhat");
const { deployOnPlume } = require("../../utils/deploy-l2");
const {
  deployWithConfirmation,
  withConfirmation,
} = require("../../utils/deploy");
const addresses = require("../../utils/addresses");
const {
  deployPlumeRoosterAMOStrategyImplementation,
} = require("../deployActions");
const { isFork, oethUnits } = require("../../test/helpers");
const { setERC20TokenBalance } = require("../../test/_fund");
const { utils } = require("ethers");

module.exports = deployOnPlume(
  {
    deployName: "008_rooster_amo",
  },
  async () => {
    const { deployerAddr } = await getNamedAccounts();
    const sDeployer = await ethers.getSigner(deployerAddr);
    const cOETHpVaultProxy = await ethers.getContract("OETHPlumeVaultProxy");
    const weth = await ethers.getContractAt("IWETH9", addresses.plume.WETH);
    const deployerWethBalance = await weth
      .connect(sDeployer)
      .balanceOf(sDeployer.address);

    console.log("Deployer WETH balance", deployerWethBalance.toString());
    if (!isFork) {
      if (deployerWethBalance.lt(oethUnits("1"))) {
        throw new Error(
          "Deployer needs at least 1e18 of WETH to mint the initial balance"
        );
      }
    }

    const cOETHpVault = await ethers.getContractAt(
      "IVault",
      cOETHpVaultProxy.address
    );

    await deployWithConfirmation("RoosterAMOStrategyProxy");
    const cAMOStrategyProxy = await ethers.getContract(
      "RoosterAMOStrategyProxy"
    );

    if (isFork) {
      // Just pretend wPlume is the reward token for testing
      await deployWithConfirmation("MockMaverickDistributor", [
        addresses.plume.WPLUME,
      ]);
      const cMockMaverickDistributor = await ethers.getContract(
        "MockMaverickDistributor"
      );

      await withConfirmation(
        cMockMaverickDistributor
          .connect(sDeployer)
          .setRewardTokenAmount(oethUnits("1"))
      );

      // Fund the mock contract
      const wPlume = await ethers.getContractAt(
        "IWETH9",
        addresses.plume.WPLUME
      );
      await withConfirmation(
        wPlume.connect(sDeployer).deposit({ value: oethUnits("10") })
      );
      await withConfirmation(
        wPlume
          .connect(sDeployer)
          .transfer(cMockMaverickDistributor.address, oethUnits("10"))
      );
    }

    const cAMOStrategyImpl = await deployPlumeRoosterAMOStrategyImplementation(
      addresses.plume.OethpWETHRoosterPool
    );
    const strategyImplInitData = cAMOStrategyImpl.interface.encodeFunctionData(
      "initialize()",
      []
    );

    // prettier-ignore
    await withConfirmation(
      cAMOStrategyProxy
        .connect(sDeployer)["initialize(address,address,bytes)"](
          cAMOStrategyImpl.address,
          addresses.plume.timelock,
          strategyImplInitData
        )
    );

    const cAMOStrategy = await ethers.getContractAt(
      "RoosterAMOStrategy",
      cAMOStrategyProxy.address
    );

    if (isFork) {
      // 1 WETH
      await setERC20TokenBalance(sDeployer.address, weth, "1", hre);
    }

    // transfer 1e16 of WETH to the strategy to mint the initial position
    await weth
      .connect(sDeployer)
      .transfer(cAMOStrategy.address, oethUnits("0.01"));

    return {
      actions: [
        {
          // Approve the AMO strategy on the Vault
          contract: cOETHpVault,
          signature: "approveStrategy(address)",
          args: [cAMOStrategy.address],
        },
        {
          // Set strategy as whitelisted one to mint OETHp tokens
          contract: cOETHpVault,
          signature: "addStrategyToMintWhitelist(address)",
          args: [cAMOStrategy.address],
        },
        {
          // Safe approve tokens
          contract: cAMOStrategy,
          signature: "mintInitialPosition()",
          args: [],
        },
        {
          // Safe approve tokens
          contract: cAMOStrategy,
          signature: "setAllowedPoolWethShareInterval(uint256,uint256)",
          args: [utils.parseUnits("0.10", 18), utils.parseUnits("0.25", 18)],
        },
        {
          // Set Harvester address to the multisig
          contract: cAMOStrategy,
          signature: "setHarvesterAddress(address)",
          args: [addresses.multichainStrategist],
        },
      ],
    };
  }
);
