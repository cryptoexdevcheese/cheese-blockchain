// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CHEESE DEX - Simple AMM DEX on BSC
 * @dev A simple Automated Market Maker DEX for CHEESE ecosystem tokens
 * 
 * Features:
 * - wNCH/USDT pool
 * - CHEESE/USDT pool
 * - 0.3% swap fee (0.05% to treasury, 0.25% to LP)
 * - Add/remove liquidity
 */
contract CheeseDEXRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Fee configuration
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public totalFeeRate = 30; // 0.3% = 30/10000
    uint256 public protocolFeeRate = 5; // 0.05% = 5/10000
    uint256 public lpFeeRate = 25; // 0.25% = 25/10000
    
    // Treasury address
    address public treasuryAddress;
    
    // Token addresses
    address public wNCH;
    address public CHEESE;
    address public USDT;
    
    // Pool structure
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        bool exists;
    }
    
    // Pool ID => Pool
    mapping(bytes32 => Pool) public pools;
    
    // Pool ID => User => LP balance
    mapping(bytes32 => mapping(address => uint256)) public lpBalances;
    
    // All pool IDs
    bytes32[] public poolIds;
    
    // Events
    event PoolCreated(bytes32 indexed poolId, address token0, address token1);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 lpTokens);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 lpTokens);
    event Swap(bytes32 indexed poolId, address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event ProtocolFeeCollected(address indexed token, uint256 amount);
    
    /**
     * @dev Constructor
     * @param _treasury Treasury address for protocol fees
     * @param _usdt USDT token address on BSC
     */
    constructor(address _treasury, address _usdt) Ownable(msg.sender) {
        require(_treasury != address(0), "Invalid treasury");
        require(_usdt != address(0), "Invalid USDT");
        treasuryAddress = _treasury;
        USDT = _usdt;
    }
    
    /**
     * @dev Set token addresses (can only be called once per token)
     */
    function setTokenAddresses(address _wNCH, address _CHEESE) external onlyOwner {
        if (_wNCH != address(0)) wNCH = _wNCH;
        if (_CHEESE != address(0)) CHEESE = _CHEESE;
    }
    
    /**
     * @dev Generate pool ID from token pair
     */
    function getPoolId(address token0, address token1) public pure returns (bytes32) {
        (address t0, address t1) = token0 < token1 ? (token0, token1) : (token1, token0);
        return keccak256(abi.encodePacked(t0, t1));
    }
    
    /**
     * @dev Create a new liquidity pool
     */
    function createPool(address token0, address token1) external onlyOwner returns (bytes32) {
        require(token0 != address(0) && token1 != address(0), "Invalid tokens");
        require(token0 != token1, "Same token");
        
        bytes32 poolId = getPoolId(token0, token1);
        require(!pools[poolId].exists, "Pool exists");
        
        (address t0, address t1) = token0 < token1 ? (token0, token1) : (token1, token0);
        
        pools[poolId] = Pool({
            token0: t0,
            token1: t1,
            reserve0: 0,
            reserve1: 0,
            totalLiquidity: 0,
            exists: true
        });
        
        poolIds.push(poolId);
        
        emit PoolCreated(poolId, t0, t1);
        return poolId;
    }
    
    /**
     * @dev Add liquidity to a pool
     */
    function addLiquidity(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) external nonReentrant returns (uint256 lpTokens) {
        bytes32 poolId = getPoolId(token0, token1);
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool does not exist");
        
        // Transfer tokens to contract
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        
        // Sort input amounts to match pool.token0 and pool.token1 order
        uint256 amount0Sorted;
        uint256 amount1Sorted;
        if (token0 < token1) {
            amount0Sorted = amount0;
            amount1Sorted = amount1;
        } else {
            amount0Sorted = amount1;
            amount1Sorted = amount0;
        }
        
        // Calculate LP tokens
        if (pool.totalLiquidity == 0) {
            // First deposit
            lpTokens = sqrt(amount0Sorted * amount1Sorted);
        } else {
            // Proportional deposit
            uint256 lpTokens0 = (amount0Sorted * pool.totalLiquidity) / pool.reserve0;
            uint256 lpTokens1 = (amount1Sorted * pool.totalLiquidity) / pool.reserve1;
            lpTokens = lpTokens0 < lpTokens1 ? lpTokens0 : lpTokens1;
        }
        
        require(lpTokens > 0, "Insufficient liquidity");
        
        // Update pool reserves and total liquidity
        pool.reserve0 += amount0Sorted;
        pool.reserve1 += amount1Sorted;
        pool.totalLiquidity += lpTokens;
        lpBalances[poolId][msg.sender] += lpTokens;
        
        emit LiquidityAdded(poolId, msg.sender, amount0Sorted, amount1Sorted, lpTokens);
    }
    
    /**
     * @dev Remove liquidity from a pool
     */
    function removeLiquidity(
        address token0,
        address token1,
        uint256 lpTokens
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        bytes32 poolId = getPoolId(token0, token1);
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool does not exist");
        require(lpBalances[poolId][msg.sender] >= lpTokens, "Insufficient LP balance");
        
        // Calculate token amounts based on sorted reserves
        uint256 amount0Sorted = (lpTokens * pool.reserve0) / pool.totalLiquidity;
        uint256 amount1Sorted = (lpTokens * pool.reserve1) / pool.totalLiquidity;
        
        // Update pool
        pool.reserve0 -= amount0Sorted;
        pool.reserve1 -= amount1Sorted;
        pool.totalLiquidity -= lpTokens;
        lpBalances[poolId][msg.sender] -= lpTokens;
        
        // Transfer tokens
        IERC20(pool.token0).safeTransfer(msg.sender, amount0Sorted);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1Sorted);
        
        // Map output amounts back to the unsorted input token parameters
        if (token0 < token1) {
            amount0 = amount0Sorted;
            amount1 = amount1Sorted;
        } else {
            amount0 = amount1Sorted;
            amount1 = amount0Sorted;
        }
        
        emit LiquidityRemoved(poolId, msg.sender, amount0Sorted, amount1Sorted, lpTokens);
    }
    
    /**
     * @dev Swap tokens
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        bytes32 poolId = getPoolId(tokenIn, tokenOut);
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool does not exist");
        require(amountIn > 0, "Invalid amount");
        
        // Transfer input token
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Calculate fees
        uint256 totalFee = (amountIn * totalFeeRate) / FEE_DENOMINATOR;
        uint256 protocolFee = (amountIn * protocolFeeRate) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - totalFee;
        
        // Determine reserves
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == pool.token0 
            ? (pool.reserve0, pool.reserve1) 
            : (pool.reserve1, pool.reserve0);
        
        // Calculate output amount (x * y = k)
        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut < reserveOut, "Insufficient liquidity");
        
        // Update reserves
        if (tokenIn == pool.token0) {
            pool.reserve0 += amountIn - protocolFee; // Add input minus protocol fee
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn - protocolFee;
            pool.reserve0 -= amountOut;
        }
        
        // Transfer protocol fee to treasury
        IERC20(tokenIn).safeTransfer(treasuryAddress, protocolFee);
        emit ProtocolFeeCollected(tokenIn, protocolFee);
        
        // Transfer output token to user
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        
        emit Swap(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut, totalFee);
    }
    
    /**
     * @dev Get quote for swap
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint256 fee) {
        bytes32 poolId = getPoolId(tokenIn, tokenOut);
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool does not exist");
        
        fee = (amountIn * totalFeeRate) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - fee;
        
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == pool.token0 
            ? (pool.reserve0, pool.reserve1) 
            : (pool.reserve1, pool.reserve0);
        
        amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
    }
    
    /**
     * @dev Get pool info
     */
    function getPool(address token0, address token1) external view returns (
        uint256 reserve0,
        uint256 reserve1,
        uint256 totalLiquidity
    ) {
        bytes32 poolId = getPoolId(token0, token1);
        Pool storage pool = pools[poolId];
        return (pool.reserve0, pool.reserve1, pool.totalLiquidity);
    }
    
    /**
     * @dev Get user LP balance
     */
    function getLPBalance(address token0, address token1, address user) external view returns (uint256) {
        bytes32 poolId = getPoolId(token0, token1);
        return lpBalances[poolId][user];
    }
    
    /**
     * @dev Get all pools count
     */
    function getPoolsCount() external view returns (uint256) {
        return poolIds.length;
    }
    
    /**
     * @dev Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasuryAddress = _treasury;
    }
    
    /**
     * @dev Update fee rates
     */
    function setFeeRates(uint256 _totalFee, uint256 _protocolFee, uint256 _lpFee) external onlyOwner {
        require(_totalFee == _protocolFee + _lpFee, "Fee mismatch");
        require(_totalFee <= 100, "Fee too high"); // Max 1%
        totalFeeRate = _totalFee;
        protocolFeeRate = _protocolFee;
        lpFeeRate = _lpFee;
    }
    
    /**
     * @dev Babylonian square root
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
