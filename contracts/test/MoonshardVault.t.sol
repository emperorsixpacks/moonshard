// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MoonshardVault} from "../src/MoonshardVault.sol";

contract TestG is ERC20 {
    constructor() ERC20("Test G$", "G$") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

/// Token that tries to re-enter `vault.claim` with a second valid voucher while the first transfer is in flight.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    MoonshardVault private vault;
    address private to;
    uint256 private id;
    uint256 private amount;
    uint64 private deadline;
    bytes private sig;
    bool private armed;
    bool public reenterAttempted;
    bool public reenterSucceeded;

    function mint(address account, uint256 value) external {
        balanceOf[account] += value;
    }

    function arm(MoonshardVault v, address to_, uint256 id_, uint256 amount_, uint64 deadline_, bytes calldata sig_) external {
        vault = v;
        to = to_;
        id = id_;
        amount = amount_;
        deadline = deadline_;
        sig = sig_;
        armed = true;
    }

    function transfer(address recipient, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[recipient] += value;
        if (armed) {
            armed = false;
            reenterAttempted = true;
            try vault.claim(to, id, amount, deadline, sig) {
                reenterSucceeded = true;
            } catch {}
        }
        return true;
    }
}

contract MoonshardVaultTest is Test {
    MoonshardVault vault;
    TestG token;

    uint256 signerPk = 0xA11CE;
    address signer;
    address owner = address(0xB0B);
    address alice = address(0xA11);
    address relayer = address(0xDEAD);

    uint256 constant MAX_VOUCHER = 1_000 ether;
    uint256 constant DAILY_CAP = 2_500 ether;

    function setUp() public {
        vm.warp(1_800_000_000);
        signer = vm.addr(signerPk);
        token = new TestG();
        vault = new MoonshardVault(IERC20(address(token)), signer, owner, MAX_VOUCHER, DAILY_CAP);
        token.transfer(address(vault), 100_000 ether);
    }

    function _sign(uint256 pk, address to, uint256 id, uint256 amount, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _signWith(vault, pk, to, id, amount, deadline);
    }

    function _signWith(MoonshardVault v, uint256 pk, address to, uint256 id, uint256 amount, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(v.SPOIL_TYPEHASH(), to, id, amount, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", v.DOMAIN_SEPARATOR(), structHash));
        (uint8 vv, bytes32 r, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(r, ss, vv);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function test_claim_pays_recipient() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 1, 500 ether, dl);
        vault.claim(alice, 1, 500 ether, dl, sig);
        assertEq(token.balanceOf(alice), 500 ether);
        assertTrue(vault.claimed(1));
    }

    function test_relayed_claim_pays_to_not_sender() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 2, 100 ether, dl);
        vm.prank(relayer);
        vault.claim(alice, 2, 100 ether, dl, sig);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_replay_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 3, 100 ether, dl);
        vault.claim(alice, 3, 100 ether, dl, sig);
        vm.expectRevert(MoonshardVault.AlreadyClaimed.selector);
        vault.claim(alice, 3, 100 ether, dl, sig);
    }

    function test_expired_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 4, 100 ether, dl);
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(MoonshardVault.Expired.selector);
        vault.claim(alice, 4, 100 ether, dl, sig);
    }

    function test_wrong_signer_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(0xBAD, alice, 5, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 5, 100 ether, dl, sig);
    }

    function test_tampered_amount_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 6, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 6, 200 ether, dl, sig);
    }

    function test_tampered_recipient_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 7, 100 ether, dl);
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(relayer, 7, 100 ether, dl, sig);
    }

    function test_over_voucher_cap_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 8, MAX_VOUCHER + 1, dl);
        vm.expectRevert(MoonshardVault.OverVoucherCap.selector);
        vault.claim(alice, 8, MAX_VOUCHER + 1, dl, sig);
    }

    function test_daily_cap_blocks_then_resets_next_day() public {
        uint64 dl = _deadline();
        vault.claim(alice, 10, 1_000 ether, dl, _sign(signerPk, alice, 10, 1_000 ether, dl));
        vault.claim(alice, 11, 1_000 ether, dl, _sign(signerPk, alice, 11, 1_000 ether, dl));
        bytes memory sig3 = _sign(signerPk, alice, 12, 1_000 ether, dl);
        vm.expectRevert(MoonshardVault.OverDailyCap.selector);
        vault.claim(alice, 12, 1_000 ether, dl, sig3);
        vm.warp(block.timestamp + 1 days);
        vault.claim(alice, 12, 1_000 ether, dl, sig3);
        assertEq(token.balanceOf(alice), 3_000 ether);
    }

    function test_pause_blocks_claims() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 20, 100 ether, dl);
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.claim(alice, 20, 100 ether, dl, sig);
        vm.prank(owner);
        vault.unpause();
        vault.claim(alice, 20, 100 ether, dl, sig);
    }

    function test_only_owner_withdraws() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.withdraw(alice, 1 ether);

        vm.prank(owner);
        vault.withdraw(owner, 500 ether);
        assertEq(token.balanceOf(owner), 500 ether);
    }

    function test_only_owner_sets_signer_and_caps() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.setSigner(alice);

        vm.startPrank(owner);
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        vault.setSigner(address(0));
        vault.setSigner(alice);
        vault.setCaps(5 ether, 10 ether);
        vm.stopPrank();
        assertEq(vault.signer(), alice);
        assertEq(vault.maxPerVoucher(), 5 ether);
        assertEq(vault.dailyCap(), 10 ether);
    }

    function test_rotated_signer_invalidates_old_vouchers() public {
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 30, 100 ether, dl);
        vm.prank(owner);
        vault.setSigner(address(0xCAFE));
        vm.expectRevert(MoonshardVault.BadSignature.selector);
        vault.claim(alice, 30, 100 ether, dl, sig);
    }

    function test_two_step_ownership() public {
        vm.prank(owner);
        vault.transferOwnership(alice);
        assertEq(vault.owner(), owner);
        vm.prank(alice);
        vault.acceptOwnership();
        assertEq(vault.owner(), alice);
    }

    // renounceOwnership() is inherited from Ownable and would let one mistaken (or phished) owner transaction
    // remove pause, withdraw, setSigner and setCaps for ever. Ownership can only move with transferOwnership +
    // acceptOwnership, which cannot end with no owner.
    function test_renounce_ownership_reverts_for_the_owner() public {
        vm.prank(owner);
        vm.expectRevert(MoonshardVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner, "owner unchanged");
    }

    function test_renounce_ownership_reverts_for_everyone_else_too() public {
        vm.prank(alice);
        vm.expectRevert(MoonshardVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner, "owner unchanged");
    }

    function test_admin_powers_survive_a_renounce_attempt() public {
        vm.startPrank(owner);
        vm.expectRevert(MoonshardVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        // all four owner powers still work
        vault.pause();
        vault.unpause();
        vault.setSigner(alice);
        vault.setCaps(1 ether, 2 ether);
        vault.withdraw(owner, 1 ether);
        vm.stopPrank();
        assertEq(vault.owner(), owner);
        assertEq(vault.signer(), alice);
        assertEq(token.balanceOf(owner), 1 ether);
    }

    function test_constructor_rejects_zero_token_or_signer() public {
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        new MoonshardVault(IERC20(address(0)), signer, owner, 1, 1);
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        new MoonshardVault(IERC20(address(token)), address(0), owner, 1, 1);
    }

    function testFuzz_amount_over_voucher_cap_always_reverts(uint256 amount) public {
        amount = bound(amount, MAX_VOUCHER + 1, type(uint128).max);
        uint64 dl = _deadline();
        bytes memory sig = _sign(signerPk, alice, 99, amount, dl);
        vm.expectRevert(MoonshardVault.OverVoucherCap.selector);
        vault.claim(alice, 99, amount, dl, sig);
    }

    // ---- gaps found by mutation testing (non-owner setCaps/pause, zero recipient, reentrancy) ----

    function test_only_owner_sets_caps() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.setCaps(1 ether, 2 ether);
        assertEq(vault.maxPerVoucher(), MAX_VOUCHER);
    }

    function test_only_owner_pauses_and_unpauses() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.pause();

        vm.prank(owner);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vault.unpause();
        assertTrue(vault.paused());
    }

    function test_claim_to_zero_address_reverts() public {
        uint64 dl = _deadline();
        bytes memory sig = _signWith(vault, signerPk, address(0), 40, 100 ether, dl);
        vm.expectRevert(MoonshardVault.ZeroAddress.selector);
        vault.claim(address(0), 40, 100 ether, dl, sig);
    }

    function test_reentrant_token_cannot_claim_a_second_voucher_mid_transfer() public {
        ReentrantToken rt = new ReentrantToken();
        MoonshardVault v2 = new MoonshardVault(IERC20(address(rt)), signer, owner, MAX_VOUCHER, DAILY_CAP);
        rt.mint(address(v2), 10_000 ether);
        uint64 dl = _deadline();
        bytes memory sig1 = _signWith(v2, signerPk, alice, 50, 100 ether, dl);
        bytes memory sig2 = _signWith(v2, signerPk, alice, 51, 100 ether, dl);
        rt.arm(v2, alice, 51, 100 ether, dl, sig2);

        v2.claim(alice, 50, 100 ether, dl, sig1);

        assertTrue(rt.reenterAttempted(), "token should have attempted re-entry");
        assertFalse(rt.reenterSucceeded(), "re-entrant claim must not succeed");
        assertTrue(v2.claimed(50));
        assertFalse(v2.claimed(51));
        assertEq(rt.balanceOf(alice), 100 ether);
    }
}
