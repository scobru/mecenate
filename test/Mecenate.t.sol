// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Mecenate} from "../src/Mecenate.sol";

contract Token is ERC20("Test", "T") {
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MecenateTest is Test {
    Mecenate m;
    Token t;
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address treasury = makeAddr("treasury");
    address BURN = 0x000000000000000000000000000000000000dEaD;
    bytes32 constant DATA = keccak256("data");
    bytes32 constant CIPHER = keccak256("cipher");
    bytes32 PROOF = keccak256(abi.encodePacked(DATA, sha256("key"), CIPHER));

    function setUp() public {
        m = new Mecenate(treasury, 100); // 1%
        t = new Token();
        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? seller : buyer;
            t.mint(u, 1000);
            vm.prank(u);
            t.approve(address(m), type(uint256).max);
        }
    }

    function _post() internal returns (uint256 id) {
        vm.prank(seller);
        id = m.create(t, 100, 50, 1000, 1 days, PROOF, "freenet:abc");
    }

    function _accepted() internal returns (uint256 id) {
        id = _post();
        vm.prank(buyer);
        m.accept(id, "pk");
    }

    function _submitted() internal returns (uint256 id) {
        id = _accepted();
        vm.prank(seller);
        m.submit(id, "ek");
    }

    function _status(uint256 id) internal view returns (Mecenate.Status s) {
        s = m.getPost(id).status;
    }

    function test_happyPath() public {
        uint256 id = _submitted();
        vm.prank(buyer);
        m.release(id);
        assertEq(t.balanceOf(seller), 1050);
        assertEq(t.balanceOf(buyer), 950);
        assertEq(uint8(_status(id)), uint8(Mecenate.Status.Finalized));
        (uint128 finalized,) = m.stats(seller);
        assertEq(finalized, 1);
        vm.prank(seller);
        vm.expectRevert("proof");
        m.reveal(id, "wrong", DATA, CIPHER);
        vm.prank(seller);
        m.reveal(id, "key", DATA, CIPHER);
        assertEq(m.getPost(id).revealedKey, "key");
        assertEq(m.getPost(id).uri, "freenet:abc");
    }

    function test_anyoneReleasesAfterDeadline() public {
        uint256 id = _submitted();
        vm.expectRevert("too early");
        m.release(id);
        vm.warp(block.timestamp + 1 days + 1);
        m.release(id);
        assertEq(t.balanceOf(seller), 1050);
    }

    function test_punish() public {
        uint256 id = _submitted();
        vm.prank(buyer);
        m.punish(id, 120); // stake is 100 + 50 payment; ratio 10% so cost 12
        assertEq(t.balanceOf(BURN), 132);
        assertEq(t.balanceOf(seller), 930);
        assertEq(t.balanceOf(buyer), 938);
        assertEq(t.balanceOf(address(m)), 0);
        (, uint128 punished) = m.stats(seller);
        assertEq(punished, 1);
    }

    function test_punishRoundsCostUp() public {
        uint256 id = _submitted();
        vm.prank(buyer);
        m.punish(id, 1);
        assertEq(t.balanceOf(BURN), 2);
    }

    function test_noPunishAfterDeadlineOrByOthers() public {
        uint256 id = _submitted();
        vm.prank(seller);
        vm.expectRevert("status");
        m.punish(id, 1);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(buyer);
        vm.expectRevert("status");
        m.punish(id, 1);
    }

    function test_sellerCancelRefundsBoth() public {
        uint256 id = _accepted();
        vm.prank(seller);
        m.cancel(id);
        assertEq(t.balanceOf(seller), 1000);
        assertEq(t.balanceOf(buyer), 1000);
    }

    function test_buyerCancelOnlyAfterDeadline() public {
        uint256 id = _accepted();
        vm.prank(buyer);
        vm.expectRevert("status");
        m.cancel(id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(seller);
        vm.expectRevert(bytes("late"));
        m.submit(id, "ek");
        vm.prank(buyer);
        m.cancel(id);
        assertEq(t.balanceOf(buyer), 1000);
        assertEq(t.balanceOf(seller), 1000);
    }

    function test_noCancelAfterSubmit() public {
        uint256 id = _submitted();
        vm.prank(seller);
        vm.expectRevert("status");
        m.cancel(id);
    }

    function test_topUp() public {
        uint256 id = _accepted();
        vm.prank(seller);
        m.topUp(id, 20);
        vm.prank(seller);
        m.submit(id, "ek");
        vm.prank(buyer);
        m.release(id);
        assertEq(t.balanceOf(seller), 1050);
    }

    function test_bayFill() public {
        vm.prank(buyer);
        uint256 rid = m.request(t, 60, 100, 1000, 1 days, "pk", "need data");
        uint256 id = _post();
        vm.prank(seller);
        m.fill(rid, id);
        assertEq(uint8(_status(id)), uint8(Mecenate.Status.Accepted));
        vm.prank(seller);
        m.submit(id, "ek");
        vm.prank(buyer);
        m.release(id);
        assertEq(t.balanceOf(seller), 1060);
        assertEq(t.balanceOf(buyer), 940);
        vm.prank(buyer);
        vm.expectRevert("not buyer");
        m.cancelRequest(rid);
    }

    function test_bayRejectsWorseTerms() public {
        vm.prank(buyer);
        uint256 rid = m.request(t, 60, 200, 1000, 1 days, "pk", "need data");
        uint256 id = _post(); // stake 100 < minStake 200
        vm.prank(seller);
        vm.expectRevert("terms");
        m.fill(rid, id);
        vm.prank(buyer);
        m.cancelRequest(rid);
        assertEq(t.balanceOf(buyer), 1000);
    }

    function _bigSale() internal returns (uint256 id) {
        vm.prank(seller);
        id = m.create(t, 100, 500, 1000, 1 days, PROOF, "freenet:abc");
        vm.prank(buyer);
        m.accept(id, "pk");
        vm.prank(seller);
        m.submit(id, "ek");
    }

    function test_feeOnRelease() public {
        uint256 id = _bigSale();
        vm.prank(buyer);
        m.release(id);
        assertEq(t.balanceOf(treasury), 5); // 1% of the price, nothing on the stake
        assertEq(t.balanceOf(seller), 1000 - 100 + 600 - 5);
        assertEq(t.balanceOf(address(m)), 0);
    }

    function test_feeOnPunishOnlyOnPriceLeft() public {
        uint256 id = _bigSale();
        vm.prank(buyer);
        m.punish(id, 100); // 500 of the 600 go back to the seller: all price, so 1% of 500
        assertEq(t.balanceOf(treasury), 5);
        assertEq(t.balanceOf(seller), 1000 - 100 + 500 - 5);
        assertEq(t.balanceOf(address(m)), 0);
    }

    function test_noFeeOnCancel() public {
        uint256 id = _accepted();
        vm.prank(seller);
        m.cancel(id);
        assertEq(t.balanceOf(treasury), 0);
    }

    function test_feeIsCapped() public {
        vm.expectRevert(bytes("fee"));
        new Mecenate(treasury, 1001);
        vm.expectRevert(bytes("fee"));
        new Mecenate(address(0), 100);
    }
}
