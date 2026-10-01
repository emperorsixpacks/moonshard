// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MoonshardVault
/// @notice Holds G$ and pays "Spoils" (daily prizes / shard harvest) against EIP-712 vouchers signed by
///         the game server. A leaked signer key can only mint vouchers within the on-chain caps below.
contract MoonshardVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SPOIL_TYPEHASH =
        keccak256("Spoil(address to,uint256 id,uint256 amount,uint64 deadline)");

    IERC20 public immutable token;
    address public signer;
    uint256 public maxPerVoucher;
    uint256 public dailyCap;

    mapping(uint256 id => bool) public claimed;
    mapping(uint256 day => uint256 amount) public claimedOnDay;

    event Claimed(uint256 indexed id, address indexed to, uint256 amount);
    event SignerChanged(address indexed signer);
    event CapsChanged(uint256 maxPerVoucher, uint256 dailyCap);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error Expired();
    error AlreadyClaimed();
    error BadSignature();
    error OverVoucherCap();
    error OverDailyCap();

    constructor(IERC20 token_, address signer_, address owner_, uint256 maxPerVoucher_, uint256 dailyCap_)
        Ownable(owner_)
        EIP712("MoonshardVault", "1")
    {
        if (address(token_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
        maxPerVoucher = maxPerVoucher_;
        dailyCap = dailyCap_;
    }

    /// @notice Redeem a voucher. Anyone may submit it; funds always go to `to`.
    function claim(address to, uint256 id, uint256 amount, uint64 deadline, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();
        if (claimed[id]) revert AlreadyClaimed();
        if (amount > maxPerVoucher) revert OverVoucherCap();

        uint256 day = block.timestamp / 1 days;
        if (claimedOnDay[day] + amount > dailyCap) revert OverDailyCap();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SPOIL_TYPEHASH, to, id, amount, deadline)));
        if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert BadSignature();

        claimed[id] = true;
        claimedOnDay[day] += amount;
        token.safeTransfer(to, amount);
        emit Claimed(id, to, amount);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        signer = newSigner;
        emit SignerChanged(newSigner);
    }

    function setCaps(uint256 newMaxPerVoucher, uint256 newDailyCap) external onlyOwner {
        maxPerVoucher = newMaxPerVoucher;
        dailyCap = newDailyCap;
        emit CapsChanged(newMaxPerVoucher, newDailyCap);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }
}
