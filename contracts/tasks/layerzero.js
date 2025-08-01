// const { ethers } = require("ethers");
const { getSigner } = require("../utils/signers");
const { Options } = require("@layerzerolabs/lz-v2-utilities");
const addresses = require("../utils/addresses");

const { addressToBytes32 } = require("@layerzerolabs/lz-v2-utilities");

const endpointIds = {
  mainnet: 30101,
  arbitrum: 30110,
  base: 30184,
  plume: 30370,
};

const endpointAbi = [
  "function setConfig(address oappAddress, address receiveLibAddress, tuple(uint32 eid, uint32 configType, bytes config)[] setConfigParams) external",
  "function getSendLibrary(address _sender, uint32 _dstEid) external view returns (address)",
  "function getReceiveLibrary(address _receiver, uint32 _srcEid) external view returns (address)",
];

async function lzBridgeToken(taskArgs, hre) {
  const signer = await getSigner();

  const recipient = taskArgs.recipient || (await signer.getAddress());

  const amount = hre.ethers.utils.parseEther(taskArgs.amount);
  const destNetwork = taskArgs.destnetwork.toLowerCase();
  const endpointId = endpointIds[destNetwork];
  const srcNetwork = hre.network.name;
  const opts = Options.newOptions()
    .addExecutorLzReceiveOption(taskArgs.gaslimit || 400000, 0)
    .toBytes();

  const minAmountLD = amount.mul(999).div(1000); // 0.1% slippage
  console.log("--------------------------------");
  console.log("Amount: ", amount.toString());
  console.log("Min Amount: ", minAmountLD.toString());
  console.log("--------------------------------");

  const sendParam = {
    dstEid: endpointId,
    to: addressToBytes32(recipient),
    amountLD: amount,
    minAmountLD: minAmountLD,
    extraOptions: opts,
    composeMsg: ethers.utils.arrayify("0x"),
    oftCmd: ethers.utils.arrayify("0x"),
  };

  const oftAdapter = await hre.ethers.getContractAt(
    "OmnichainL2Adapter",
    addresses[srcNetwork].WOETHOmnichainAdapter
  );

  const woeth = await hre.ethers.getContractAt(
    "WOETH",
    srcNetwork == "mainnet"
      ? addresses.mainnet.WOETHProxy
      : addresses[srcNetwork].BridgedWOETH
  );

  console.log("Approving wOETH...");
  const approveArgs = [oftAdapter.address, amount];

  console.log("--------------------------------");
  console.log("To:      ", woeth.address);
  console.log(
    "Payload: ",
    woeth.interface.encodeFunctionData("approve(address,uint256)", approveArgs)
  );
  console.log("--------------------------------");
  if (!taskArgs.dryrun) {
    const tx = await woeth.connect(signer).approve(...approveArgs);
    console.log(
      "Balance:   ",
      (await woeth.balanceOf(await signer.getAddress())).toString()
    );
    console.log(
      "Allowance:  ",
      (
        await woeth.allowance(await signer.getAddress(), oftAdapter.address)
      ).toString()
    );
    console.log("--------------------------------");
    if (process.env.FORK != "true") {
      await hre.ethers.provider.waitForTransaction(
        tx.receipt ? tx.receipt.transactionHash : tx.hash,
        3 // Wait for 3 block confirmation
      );
    }
  }

  console.log("Computing fees...");
  const [nativeFee, lzTokenFee] = await oftAdapter
    .connect(signer)
    .quoteSend(sendParam, false);

  console.log("--------------------------------");
  console.log(`Native Fee: ${nativeFee}`);
  console.log(`LZ Token Fee: ${lzTokenFee}`);

  console.log(`OFT Fee: ${nativeFee}`);
  console.log("--------------------------------");

  const sendSig =
    "send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address)";
  const sendArgs = [sendParam, [nativeFee, 0], recipient];

  console.log("Send tx...");
  console.log("--------------------------------");
  console.log("To:      ", oftAdapter.address);
  console.log(
    "Payload: ",
    oftAdapter.interface.encodeFunctionData(sendSig, sendArgs)
  );
  console.log(
    "Value:   ",
    nativeFee.toString(),
    `wei (${hre.ethers.utils.formatEther(nativeFee)} ETH)`
  );
  console.log("--------------------------------");
  if (!taskArgs.dryrun) {
    await oftAdapter.connect(signer).send(...sendArgs, {
      value: nativeFee,
    });
  }
}

async function lzSetConfig(taskArgs, hre) {
  const signer = await getSigner();

  const srcNetwork = hre.network.name;
  const dvnAddresses = taskArgs.dvns.split(",");
  const confirmations = taskArgs.confirmations;
  const requiredDVNCount = taskArgs.dvncount;
  const remoteEid = endpointIds[taskArgs.destnetwork];

  const ulnConfig = {
    confirmations,
    requiredDVNCount,
    optionalDVNCount: 0,
    optionalDVNThreshold: 0,
    requiredDVNs: dvnAddresses,
    optionalDVNs: [],
  };

  const configTypeUlnStruct =
    "tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)";
  const encodedUlnConfig = hre.ethers.utils.defaultAbiCoder.encode(
    [configTypeUlnStruct],
    [ulnConfig]
  );

  const setConfigParamUln = {
    eid: remoteEid,
    configType: 2, // CONFIG_TYPE_ULN
    config: encodedUlnConfig,
  };

  const endpointContract = await hre.ethers.getContractAt(
    endpointAbi,
    addresses[srcNetwork].LayerZeroEndpointV2
  );

  const oAppAddress = addresses[srcNetwork].WOETHOmnichainAdapter;

  const receiveLib = await endpointContract.getReceiveLibrary(
    oAppAddress,
    remoteEid
  );

  const sendLib = await endpointContract.getSendLibrary(oAppAddress, remoteEid);

  await endpointContract.connect(signer).setConfig(
    oAppAddress, // OApp
    receiveLib, // ReceiveLib
    [setConfigParamUln]
  );

  await endpointContract.connect(signer).setConfig(
    oAppAddress, // OApp
    sendLib, // SendLib
    [setConfigParamUln]
  );
}

module.exports = {
  lzBridgeToken,
  lzSetConfig,
};
