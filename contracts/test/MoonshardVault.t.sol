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
        bytes32 structHash = keccak256(abi.encode(vault.SPOIL_TYPEHASH(), to, id, amount, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
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
}
