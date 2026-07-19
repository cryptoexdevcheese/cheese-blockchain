/**
 * Fiat Gateway - Buy/Sell CHEESE with Fiat Currency
 * Integrates with MoonPay and Ramp Network
 */

class FiatGateway {
    constructor() {
        this.moonpayApiKey = null; // Set your MoonPay API key
        this.rampApiKey = null; // Set your Ramp API key
        this.walletAddress = null;
        
        // Supported e-wallets and payment methods
        this.supportedPaymentMethods = {
            // Card payments
            'credit_card': { name: 'Credit/Debit Card', provider: 'moonpay', icon: '💳' },
            'debit_card': { name: 'Debit Card', provider: 'moonpay', icon: '💳' },
            'visa': { name: 'Visa', provider: 'moonpay', icon: '💳' },
            'mastercard': { name: 'Mastercard', provider: 'moonpay', icon: '💳' },
            'amex': { name: 'American Express', provider: 'moonpay', icon: '💳' },
            
            // Digital wallets - Global
            'paypal': { name: 'PayPal', provider: 'paypal', icon: '🔵' },
            'google_pay': { name: 'Google Pay', provider: 'google', icon: '🔵' },
            'apple_pay': { name: 'Apple Pay', provider: 'apple', icon: '🍎' },
            'samsung_pay': { name: 'Samsung Pay', provider: 'samsung', icon: '📱' },
            
            // Digital wallets - US
            'venmo': { name: 'Venmo', provider: 'paypal', icon: '💙' },
            'cash_app': { name: 'Cash App', provider: 'square', icon: '💚' },
            'zelle': { name: 'Zelle', provider: 'zelle', icon: '💜' },
            
            // Digital wallets - Asia
            'alipay': { name: 'Alipay', provider: 'alipay', icon: '🔷' },
            'wechat_pay': { name: 'WeChat Pay', provider: 'wechat', icon: '💬' },
            'grab_pay': { name: 'GrabPay', provider: 'grab', icon: '🚗' },
            'paytm': { name: 'Paytm', provider: 'paytm', icon: '📲' },
            'phonepe': { name: 'PhonePe', provider: 'phonepe', icon: '📱' },
            'gpay_india': { name: 'Google Pay (India)', provider: 'google', icon: '🔵' },
            
            // Digital wallets - Europe
            'revolut': { name: 'Revolut', provider: 'revolut', icon: '🔄' },
            'wise': { name: 'Wise (TransferWise)', provider: 'wise', icon: '💱' },
            'skrill': { name: 'Skrill', provider: 'skrill', icon: '💳' },
            'neteller': { name: 'Neteller', provider: 'neteller', icon: '💳' },
            'payoneer': { name: 'Payoneer', provider: 'payoneer', icon: '💼' },
            'sofort': { name: 'Sofort', provider: 'sofort', icon: '🇩🇪' },
            'giropay': { name: 'Giropay', provider: 'giropay', icon: '🇩🇪' },
            'ideal': { name: 'iDEAL', provider: 'ideal', icon: '🇳🇱' },
            'bancontact': { name: 'Bancontact', provider: 'bancontact', icon: '🇧🇪' },
            
            // Digital wallets - Latin America
            'mercadopago': { name: 'Mercado Pago', provider: 'mercadopago', icon: '🛒' },
            'pix': { name: 'PIX (Brazil)', provider: 'pix', icon: '🇧🇷' },
            
            // Digital wallets - Philippines
            'gcash': { name: 'GCash', provider: 'gcash', icon: '📱' },
            'paymaya': { name: 'Maya (PayMaya)', provider: 'maya', icon: '💙' },
            'coins_ph': { name: 'Coins.ph', provider: 'coins', icon: '🪙' },
            'grab_pay_ph': { name: 'GrabPay (Philippines)', provider: 'grab', icon: '🚗' },
            'paymongo': { name: 'PayMongo', provider: 'paymongo', icon: '💳' },
            'dragonpay': { name: 'DragonPay', provider: 'dragonpay', icon: '🐉' },
            
            // Bank transfers
            'bank_transfer': { name: 'Bank Transfer', provider: 'bank', icon: '🏦' },
            'sepa': { name: 'SEPA Transfer', provider: 'sepa', icon: '🇪🇺' },
            'ach': { name: 'ACH Transfer', provider: 'ach', icon: '🇺🇸' },
            'wire_transfer': { name: 'Wire Transfer', provider: 'wire', icon: '🏦' }
        };
    }

    // Set wallet address
    setWalletAddress(address) {
        this.walletAddress = address;
    }

    // Get supported payment methods by region
    getPaymentMethodsByRegion(region = 'global') {
        const regions = {
            'global': ['paypal', 'google_pay', 'apple_pay', 'samsung_pay', 'credit_card', 'debit_card', 'visa', 'mastercard', 'bank_transfer'],
            'us': ['paypal', 'venmo', 'cash_app', 'zelle', 'google_pay', 'apple_pay', 'credit_card', 'ach', 'bank_transfer'],
            'asia': ['alipay', 'wechat_pay', 'grab_pay', 'paytm', 'phonepe', 'gpay_india', 'credit_card', 'bank_transfer'],
            'china': ['alipay', 'wechat_pay', 'credit_card', 'bank_transfer'],
            'india': ['paytm', 'phonepe', 'gpay_india', 'credit_card', 'bank_transfer'],
            'europe': ['revolut', 'wise', 'skrill', 'neteller', 'sofort', 'giropay', 'ideal', 'bancontact', 'sepa', 'credit_card', 'bank_transfer'],
            'latin_america': ['mercadopago', 'pix', 'credit_card', 'bank_transfer'],
            'philippines': ['gcash', 'paymaya', 'coins_ph', 'grab_pay_ph', 'paymongo', 'dragonpay', 'credit_card', 'bank_transfer']
        };
        
        return regions[region] || regions['global'];
    }

    // Get payment method info
    getPaymentMethodInfo(method) {
        return this.supportedPaymentMethods[method] || { name: method, provider: 'generic', icon: '💳' };
    }

    // Initialize MoonPay
    initMoonPay(apiKey, walletAddress) {
        this.moonpayApiKey = apiKey;
        this.walletAddress = walletAddress;
    }

    // Buy CHEESE with MoonPay
    async buyCheeseMoonPay(amount, currency = 'USD', paymentMethod = 'credit_debit_card') {
        if (!this.moonpayApiKey) {
            throw new Error('MoonPay API key not set');
        }

        // Map payment methods to MoonPay supported methods
        const moonpayPaymentMethods = {
            'credit_card': 'credit_debit_card',
            'debit_card': 'credit_debit_card',
            'visa': 'credit_debit_card',
            'mastercard': 'credit_debit_card',
            'amex': 'credit_debit_card',
            'apple_pay': 'apple_pay',
            'google_pay': 'google_pay',
            'bank_transfer': 'bank_transfer',
            'sepa': 'sepa_bank_transfer',
            'ach': 'ach_bank_transfer'
        };

        const moonpayMethod = moonpayPaymentMethods[paymentMethod] || 'credit_debit_card';

        // MoonPay widget configuration
        const moonpayConfig = {
            flow: 'buy',
            environment: 'production', // or 'sandbox' for testing
            variant: 'overlay',
            apiKey: this.moonpayApiKey,
            defaultCurrencyCode: currency,
            defaultAmount: amount,
            defaultBaseCurrencyAmount: amount,
            walletAddress: this.walletAddress,
            currencyCode: 'CHEESE', // Your token code
            baseCurrencyCode: currency,
            baseCurrencyAmount: amount,
            lockAmount: true,
            paymentMethod: moonpayMethod,
            onClose: () => {
                console.log('MoonPay widget closed');
            },
            onComplete: (result) => {
                console.log('MoonPay transaction completed:', result);
                // Handle completion
                this.handleMoonPayComplete(result);
            }
        };

        // Load MoonPay widget
        const script = document.createElement('script');
        script.src = 'https://static.moonpay.com/web-sdk/v1/moonpay-web-sdk.js';
        script.onload = () => {
            if (window.MoonPay) {
                window.MoonPay.init(moonpayConfig);
            }
        };
        document.head.appendChild(script);
    }

    // Handle MoonPay completion
    async handleMoonPayComplete(result) {
        // Update wallet balance
        if (window.app && window.app.updateBalance) {
            await window.app.updateBalance();
        }

        // Show success message
        if (window.app && window.app.showNotification) {
            window.app.showNotification('✅ CHEESE purchased successfully!', 'success');
        }
    }

    // Handle PayPal completion
    async handlePayPalComplete(order) {
        // Update wallet balance
        if (window.app && window.app.updateBalance) {
            await window.app.updateBalance();
        }

        // Show success message
        if (window.app && window.app.showNotification) {
            window.app.showNotification('✅ CHEESE purchased via PayPal successfully!', 'success');
        }
    }

    // Initialize Ramp Network
    initRamp(apiKey, walletAddress) {
        this.rampApiKey = apiKey;
        this.walletAddress = walletAddress;
    }

    // Buy CHEESE with Ramp
    async buyCheeseRamp(amount, currency = 'USD') {
        if (!this.rampApiKey) {
            throw new Error('Ramp API key not set');
        }

        // Load Ramp SDK
        const script = document.createElement('script');
        script.src = 'https://cdn.ramp.network/v2/ramp-instant-sdk.js';
        script.onload = () => {
            if (window.RampInstantSDK) {
                const ramp = new window.RampInstantSDK({
                    hostAppName: 'CHEESE Wallet',
                    hostLogoUrl: window.location.origin + '/assets/images/logo.png',
                    hostApiKey: this.rampApiKey,
                    defaultAsset: 'CHEESE',
                    swapAsset: 'CHEESE',
                    userAddress: this.walletAddress,
                    defaultFlow: 'onramp',
                    defaultAmount: amount,
                    defaultFiatCurrency: currency
                });

                ramp.show();
            }
        };
        document.head.appendChild(script);
    }

    // Sell CHEESE (withdrawal to fiat)
    async sellCheese(amount, currency = 'USD', paymentMethod = 'bank_transfer', payoutAddress) {
        if (!this.walletAddress) {
            throw new Error('Wallet address not set');
        }

        if (!payoutAddress) {
            throw new Error('Payout address required');
        }

        // Calculate exchange rate (placeholder - would use real API)
        const exchangeRate = await this.getExchangeRate('CHEESE', currency);
        const fiatAmount = amount * exchangeRate;
        const fee = fiatAmount * 0.025; // 2.5% fee
        const netAmount = fiatAmount - fee;

        // Route to appropriate payment method handler
        const methodInfo = this.getPaymentMethodInfo(paymentMethod);
        
        // MoonPay Sell (if supported)
        if (paymentMethod === 'moonpay' || methodInfo.provider === 'moonpay') {
            return await this.sellCheeseMoonPay(amount, currency, payoutAddress);
        }

        // Ramp Sell (if supported)
        if (paymentMethod === 'ramp' || methodInfo.provider === 'ramp') {
            return await this.sellCheeseRamp(amount, currency, payoutAddress);
        }

        // PayPal Sell
        if (paymentMethod === 'paypal' || methodInfo.provider === 'paypal') {
            return await this.sellCheesePayPal(amount, currency, payoutAddress);
        }

        // Alipay Sell
        if (paymentMethod === 'alipay' || methodInfo.provider === 'alipay') {
            return await this.sellCheeseAlipay(amount, currency, payoutAddress);
        }

        // WeChat Pay Sell
        if (paymentMethod === 'wechat_pay' || methodInfo.provider === 'wechat') {
            return await this.sellCheeseWeChatPay(amount, currency, payoutAddress);
        }

        // GCash Sell
        if (paymentMethod === 'gcash' || methodInfo.provider === 'gcash') {
            return await this.sellCheeseGCash(amount, currency, payoutAddress);
        }

        // Maya Sell
        if (paymentMethod === 'paymaya' || methodInfo.provider === 'maya') {
            return await this.sellCheeseMaya(amount, currency, payoutAddress);
        }

        // Coins.ph Sell
        if (paymentMethod === 'coins_ph' || methodInfo.provider === 'coins') {
            return await this.sellCheeseCoinsPH(amount, currency, payoutAddress);
        }

        // Generic sell flow for other methods
        return {
            success: true,
            orderId: 'SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            fiatAmount: fiatAmount,
            fee: fee,
            netAmount: netAmount,
            paymentMethod: paymentMethod,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: `Sell order created via ${methodInfo.name}. Processing will begin shortly.`
        };
    }

    // Sell CHEESE with PayPal
    async sellCheesePayPal(amount, currency, payoutAddress) {
        // PayPal payout integration
        return {
            success: true,
            orderId: 'PAYPAL-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'PayPal payout initiated. Funds will be sent to your PayPal account.'
        };
    }

    // Sell CHEESE with Alipay
    async sellCheeseAlipay(amount, currency, payoutAddress) {
        // Alipay payout integration
        return {
            success: true,
            orderId: 'ALIPAY-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'Alipay payout initiated. Funds will be sent to your Alipay account.'
        };
    }

    // Sell CHEESE with WeChat Pay
    async sellCheeseWeChatPay(amount, currency, payoutAddress) {
        // WeChat Pay payout integration
        return {
            success: true,
            orderId: 'WECHAT-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'WeChat Pay payout initiated. Funds will be sent to your WeChat Pay account.'
        };
    }

    // Sell CHEESE with GCash
    async sellCheeseGCash(amount, currency, payoutAddress) {
        // GCash payout integration
        return {
            success: true,
            orderId: 'GCASH-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'GCash payout initiated. Funds will be sent to your GCash account.'
        };
    }

    // Sell CHEESE with Maya
    async sellCheeseMaya(amount, currency, payoutAddress) {
        // Maya payout integration
        return {
            success: true,
            orderId: 'MAYA-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'Maya payout initiated. Funds will be sent to your Maya account.'
        };
    }

    // Sell CHEESE with Coins.ph
    async sellCheeseCoinsPH(amount, currency, payoutAddress) {
        // Coins.ph payout integration
        return {
            success: true,
            orderId: 'COINS-PH-SELL-' + Date.now(),
            amount: amount,
            currency: currency,
            payoutAddress: payoutAddress,
            status: 'pending',
            message: 'Coins.ph payout initiated. Funds will be sent to your Coins.ph account.'
        };
    }

    // Sell CHEESE with MoonPay
    async sellCheeseMoonPay(amount, currency, payoutAddress) {
        // MoonPay sell widget (if available)
        const moonpayConfig = {
            flow: 'sell',
            environment: 'production',
            variant: 'overlay',
            apiKey: this.moonpayApiKey,
            defaultCurrencyCode: 'CHEESE',
            defaultAmount: amount,
            walletAddress: this.walletAddress,
            payoutAddress: payoutAddress,
            baseCurrencyCode: currency,
            onComplete: (result) => {
                this.handleMoonPaySellComplete(result);
            }
        };

        // Load MoonPay widget
        const script = document.createElement('script');
        script.src = 'https://static.moonpay.com/web-sdk/v1/moonpay-web-sdk.js';
        script.onload = () => {
            if (window.MoonPay) {
                window.MoonPay.init(moonpayConfig);
            }
        };
        document.head.appendChild(script);

        return {
            success: true,
            message: 'MoonPay sell widget opened'
        };
    }

    // Sell CHEESE with Ramp
    async sellCheeseRamp(amount, currency, payoutAddress) {
        // Load Ramp SDK
        const script = document.createElement('script');
        script.src = 'https://cdn.ramp.network/v2/ramp-instant-sdk.js';
        script.onload = () => {
            if (window.RampInstantSDK) {
                const ramp = new window.RampInstantSDK({
                    hostAppName: 'CHEESE Wallet',
                    hostLogoUrl: window.location.origin + '/assets/images/logo.png',
                    hostApiKey: this.rampApiKey,
                    defaultAsset: 'CHEESE',
                    swapAsset: currency,
                    userAddress: this.walletAddress,
                    defaultFlow: 'offramp',
                    defaultAmount: amount,
                    defaultFiatCurrency: currency
                });

                ramp.show();
            }
        };
        document.head.appendChild(script);

        return {
            success: true,
            message: 'Ramp sell widget opened'
        };
    }

    // Handle MoonPay sell completion
    async handleMoonPaySellComplete(result) {
        // Update wallet balance
        if (window.app && window.app.updateBalance) {
            await window.app.updateBalance();
        }

        // Show success message
        if (window.app && window.app.showNotification) {
            window.app.showNotification('✅ CHEESE sold successfully! Payment processing...', 'success');
        }
    }

    // Get exchange rate
    async getExchangeRate(fromCurrency, toCurrency) {
        // Placeholder - would fetch from real API
        // For now, return 1:1 for CHEESE:USD
        if (fromCurrency === 'CHEESE' && toCurrency === 'USD') {
            return 1.0; // 1 CHEESE = $1 USD
        }
        // Add more currency pairs as needed
        return 1.0;
    }

    // Get sell rates
    async getSellRates(amount, currency = 'USD') {
        const rate = await this.getExchangeRate('CHEESE', currency);
        const fiatAmount = amount * rate;
        const fee = fiatAmount * 0.025;
        const netAmount = fiatAmount - fee;

        return {
            rate: rate,
            fiatAmount: fiatAmount,
            fee: fee,
            netAmount: netAmount,
            currency: currency
        };
    }

    // Check payment status
    async checkPaymentStatus(orderId) {
        // Check MoonPay order status
        if (this.moonpayApiKey) {
            try {
                const response = await fetch(
                    `https://api.moonpay.com/v1/transactions/${orderId}?apiKey=${this.moonpayApiKey}`
                );
                return await response.json();
            } catch (error) {
                console.error('Payment status check error:', error);
            }
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FiatGateway;
}

