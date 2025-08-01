// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MockRewardPool } from "./MockRewardPool.sol";

import { IRewardStaking } from "../../strategies/IRewardStaking.sol";
import { IMintableERC20, MintableERC20, ERC20 } from "../MintableERC20.sol";
import { IBurnableERC20, BurnableERC20 } from "../BurnableERC20.sol";

contract MockDepositToken is MintableERC20, BurnableERC20 {
    constructor() ERC20("DCVX", "CVX Deposit Token") {}
}

contract MockBooster {
    using SafeERC20 for IERC20;

    struct PoolInfo {
        address lptoken;
        address token;
        address crvRewards;
    }

    address public minter; // this is CVx for the booster on live
    address public crv; // Curve rewards token
    address public cvx; // Convex rewards token
    mapping(uint256 => PoolInfo) public poolInfo;

    constructor(
        address _rewardsMinter,
        address _crv,
        address _cvx
    ) public {
        minter = _rewardsMinter;
        crv = _crv;
        cvx = _cvx;
    }

    function setPool(uint256 pid, address _lpToken)
        external
        returns (address rewards)
    {
        address token = address(new MockDepositToken());
        // Deploy a new Convex Rewards Pool
        rewards = address(
            new MockRewardPool(pid, token, crv, cvx, address(this))
        );

        poolInfo[pid] = PoolInfo({
            lptoken: _lpToken,
            token: token,
            crvRewards: rewards
        });
    }

    function deposit(
        uint256 _pid,
        uint256 _amount,
        bool _stake
    ) public returns (bool) {
        PoolInfo storage pool = poolInfo[_pid];

        address lptoken = pool.lptoken;

        // hold on to the Curve LP tokens
        IERC20(lptoken).safeTransferFrom(msg.sender, address(this), _amount);

        address token = pool.token;
        if (_stake) {
            // mint Convex pool LP tokens and stake in rewards contract on user behalf
            IMintableERC20(token).mint(_amount);
            address rewardContract = pool.crvRewards;
            IERC20(token).safeApprove(rewardContract, 0);
            IERC20(token).safeApprove(rewardContract, _amount);
            IRewardStaking(rewardContract).stakeFor(msg.sender, _amount);
        } else {
            // mint Convex pool LP tokens and send to user
            IMintableERC20(token).mint(_amount);
            IERC20(token).transfer(msg.sender, _amount);
        }
        return true;
    }

    // Deposit all Curve LP tokens and stake
    function depositAll(uint256 _pid, bool _stake) external returns (bool) {
        address lptoken = poolInfo[_pid].lptoken;
        uint256 balance = IERC20(lptoken).balanceOf(msg.sender);
        deposit(_pid, balance, _stake);
        return true;
    }

    // withdraw Curve LP tokens
    function _withdraw(
        uint256 _pid,
        uint256 _amount,
        address _from,
        address _to
    ) internal {
        PoolInfo storage pool = poolInfo[_pid];

        // burn the Convex pool LP tokens
        IBurnableERC20(pool.token).burnFrom(_from, _amount);

        // return the Curve LP tokens
        IERC20(pool.lptoken).safeTransfer(_to, _amount);
    }

    // withdraw Curve LP tokens
    function withdraw(uint256 _pid, uint256 _amount) public returns (bool) {
        _withdraw(_pid, _amount, msg.sender, msg.sender);
        return true;
    }

    // withdraw all Curve LP tokens
    function withdrawAll(uint256 _pid) public returns (bool) {
        address token = poolInfo[_pid].token;
        uint256 userBal = IERC20(token).balanceOf(msg.sender);
        withdraw(_pid, userBal);
        return true;
    }

    // allow reward contracts to send here and withdraw to user
    function withdrawTo(
        uint256 _pid,
        uint256 _amount,
        address _to
    ) external returns (bool) {
        address rewardContract = poolInfo[_pid].crvRewards;
        require(msg.sender == rewardContract, "!auth");

        _withdraw(_pid, _amount, msg.sender, _to);
        return true;
    }

    // callback from reward contract when crv is received.
    function rewardClaimed(
        uint256 _pid,
        // solhint-disable-next-line no-unused-vars
        address _address,
        uint256 _amount
    ) external returns (bool) {
        address rewardContract = poolInfo[_pid].crvRewards;
        require(msg.sender == rewardContract, "!auth");

        //mint reward tokens
        // and transfer it
        IMintableERC20(minter).mint(_amount);
        IERC20(minter).transfer(msg.sender, _amount);
        return true;
    }
}
