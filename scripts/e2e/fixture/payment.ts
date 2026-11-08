export function calculateOrderTotal(prices: number[], discount: number): number {
	const subtotal = prices.reduce((sum, price) => sum + price, 0);
	return subtotal - discount;
}
