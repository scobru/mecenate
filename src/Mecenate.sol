// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Mecenate
/// @notice Griefing escrow for selling data. A seller stakes behind a post, a buyer pays, the seller
/// delivers the decryption key encrypted to the buyer, and until the deadline the buyer may burn part of
/// the seller's stake at a cost to themselves. Bay requests let a buyer escrow a reward first and have a
/// seller fill it with a post.
/// @dev Plain ERC20 only: fee-on-transfer and rebasing tokens break the accounting.
contract Mecenate {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Proposed,
        Accepted,
        Submitted,
        Finalized,
        Punished,
        Cancelled
    }

    struct Post {
        address seller;
        uint64 period; // punish window after submission; also how long the buyer waits for delivery
        uint16 ratio; // buyer pays ratio/10000 of what they burn
        Status status;
        address buyer;
        uint64 deadline;
        IERC20 token;
        uint256 stake;
        uint256 payment;
        bytes32 proofhash; // keccak256(sha256(data), sha256(key), sha256(ciphertext)), fixed before any sale
        string uri; // where the ciphertext and its description are published
        bytes buyerKey; // buyer public key the seller encrypts to
        bytes encryptedKey; // symmetric key encrypted to buyerKey: on-chain proof of delivery
        bytes revealedKey; // the symmetric key itself, once the seller makes the data public
    }

    struct Request {
        address buyer;
        uint64 minPeriod;
        uint16 maxRatio;
        IERC20 token;
        uint256 payment;
        uint256 minStake;
        bytes buyerKey;
        string description;
    }

    struct Stats {
        uint128 finalized;
        uint128 punished;
    }

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint256 public postCount;
    uint256 public requestCount;
    mapping(uint256 => Post) internal posts;
    mapping(uint256 => Request) internal requests;
    mapping(address => Stats) public stats;

    event Created(uint256 indexed id, address indexed seller);
    event Accepted(uint256 indexed id, address indexed buyer);
    event Submitted(uint256 indexed id);
    event Finalized(uint256 indexed id);
    event Punished(uint256 indexed id, uint256 burned, uint256 cost);
    event Cancelled(uint256 indexed id);
    event Revealed(uint256 indexed id);
    event Requested(uint256 indexed id, address indexed buyer);
    event Filled(uint256 indexed requestId, uint256 indexed postId);
    event RequestCancelled(uint256 indexed id);

    // ---- posts ----

    // Structs with dynamic fields are read whole: the app only has eth_call, no log queries.
    function getPost(uint256 id) external view returns (Post memory) {
        return posts[id];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return requests[id];
    }

    function create(
        IERC20 token,
        uint256 stake,
        uint256 payment,
        uint16 ratio,
        uint64 period,
        bytes32 proofhash,
        string calldata uri
    ) external returns (uint256 id) {
        require(stake > 0 && payment > 0 && period > 0, "zero");
        id = ++postCount;
        Post storage p = posts[id];
        p.seller = msg.sender;
        p.period = period;
        p.ratio = ratio;
        p.status = Status.Proposed;
        p.token = token;
        p.stake = stake;
        p.payment = payment;
        p.proofhash = proofhash;
        p.uri = uri;
        emit Created(id, msg.sender);
        token.safeTransferFrom(msg.sender, address(this), stake);
    }

    function accept(uint256 id, bytes calldata buyerKey) external {
        Post storage p = posts[id];
        require(p.status == Status.Proposed, "status");
        _accept(id, p, msg.sender, buyerKey);
        p.token.safeTransferFrom(msg.sender, address(this), p.payment);
    }

    /// Seller adds stake before delivery; more stake only ever helps the buyer.
    function topUp(uint256 id, uint256 amount) external {
        Post storage p = posts[id];
        require(msg.sender == p.seller && (p.status == Status.Proposed || p.status == Status.Accepted), "status");
        p.stake += amount;
        p.token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// Delivery: the payment joins the stake, so from here the buyer can only release or punish, never refund.
    function submit(uint256 id, bytes calldata encryptedKey) external {
        Post storage p = posts[id];
        require(msg.sender == p.seller && p.status == Status.Accepted, "status");
        // Hard cutoff: a late submit could lose a race with the buyer's cancel and leak the key from the mempool.
        require(block.timestamp <= p.deadline, "late");
        p.encryptedKey = encryptedKey;
        p.stake += p.payment;
        p.status = Status.Submitted;
        p.deadline = uint64(block.timestamp) + p.period;
        emit Submitted(id);
    }

    /// The buyer releases early, or anyone releases once the punish window is over.
    function release(uint256 id) external {
        Post storage p = posts[id];
        require(p.status == Status.Submitted, "status");
        require(msg.sender == p.buyer || block.timestamp > p.deadline, "too early");
        uint256 amount = p.stake;
        p.stake = 0;
        p.status = Status.Finalized;
        stats[p.seller].finalized++;
        emit Finalized(id);
        p.token.safeTransfer(p.seller, amount);
    }

    /// Burns `amount` of the stake; the buyer burns cost = amount * ratio / 10000 of their own on top.
    function punish(uint256 id, uint256 amount) external {
        Post storage p = posts[id];
        require(msg.sender == p.buyer && p.status == Status.Submitted && block.timestamp <= p.deadline, "status");
        require(amount > 0 && amount <= p.stake, "amount");
        uint256 cost = (amount * p.ratio + 9_999) / 10_000; // round up so tiny punishments are not free
        uint256 rest = p.stake - amount;
        p.stake = 0;
        p.status = Status.Punished;
        stats[p.seller].punished++;
        emit Punished(id, amount, cost);
        if (cost > 0) p.token.safeTransferFrom(msg.sender, BURN, cost);
        p.token.safeTransfer(BURN, amount);
        if (rest > 0) p.token.safeTransfer(p.seller, rest);
    }

    /// Seller withdraws before delivery, or the buyer gets out once the seller has not delivered within `period`.
    function cancel(uint256 id) external {
        Post storage p = posts[id];
        Status s = p.status;
        bool bySeller = msg.sender == p.seller && (s == Status.Proposed || s == Status.Accepted);
        bool byBuyer = msg.sender == p.buyer && s == Status.Accepted && block.timestamp > p.deadline;
        require(bySeller || byBuyer, "status");
        uint256 stake = p.stake;
        uint256 payment = s == Status.Accepted ? p.payment : 0;
        p.stake = 0;
        p.status = Status.Cancelled;
        emit Cancelled(id);
        p.token.safeTransfer(p.seller, stake);
        if (payment > 0) p.token.safeTransfer(p.buyer, payment);
    }

    /// Seller publishes the symmetric key once the sale is closed, making the data public.
    /// The key must match the proofhash, so a wrong key cannot be passed off as the real one.
    function reveal(uint256 id, bytes calldata key, bytes32 dataHash, bytes32 cipherHash) external {
        Post storage p = posts[id];
        require(msg.sender == p.seller && (p.status == Status.Finalized || p.status == Status.Punished), "status");
        require(keccak256(abi.encodePacked(dataHash, sha256(key), cipherHash)) == p.proofhash, "proof");
        p.revealedKey = key;
        emit Revealed(id);
    }

    // ---- bay ----

    function request(
        IERC20 token,
        uint256 payment,
        uint256 minStake,
        uint16 maxRatio,
        uint64 minPeriod,
        bytes calldata buyerKey,
        string calldata description
    ) external returns (uint256 id) {
        require(payment > 0 && minStake > 0, "zero");
        id = ++requestCount;
        requests[id] = Request(msg.sender, minPeriod, maxRatio, token, payment, minStake, buyerKey, description);
        emit Requested(id, msg.sender);
        token.safeTransferFrom(msg.sender, address(this), payment);
    }

    /// Seller answers a request with one of their open posts; the escrowed reward becomes its payment.
    function fill(uint256 requestId, uint256 postId) external {
        Request memory r = requests[requestId];
        Post storage p = posts[postId];
        require(r.buyer != address(0), "no request");
        require(msg.sender == p.seller && p.status == Status.Proposed, "status");
        require(
            p.token == r.token && p.payment <= r.payment && p.stake >= r.minStake && p.ratio <= r.maxRatio
                && p.period >= r.minPeriod,
            "terms"
        );
        delete requests[requestId];
        p.payment = r.payment;
        emit Filled(requestId, postId);
        _accept(postId, p, r.buyer, r.buyerKey);
    }

    function cancelRequest(uint256 id) external {
        Request memory r = requests[id];
        require(msg.sender == r.buyer, "not buyer");
        delete requests[id];
        emit RequestCancelled(id);
        r.token.safeTransfer(r.buyer, r.payment);
    }

    function _accept(uint256 id, Post storage p, address buyer, bytes memory buyerKey) private {
        p.buyer = buyer;
        p.buyerKey = buyerKey;
        p.status = Status.Accepted;
        p.deadline = uint64(block.timestamp) + p.period;
        emit Accepted(id, buyer);
    }
}
