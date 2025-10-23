import { usePostHog } from 'posthog-js/react'

const events = [
    {
        name: 'Product Added',
        properties: {
            product_id: 'SomeProductID',
            name: 'SomeProductName',
            price: 42,
            quantity: 1,
        },
    },
    {
        name: 'Products Searched',
        properties: {
            products: [
                {
                    product_id: 'SomeProductID',
                    name: 'SomeProductName',
                    price: 42,
                },
                {
                    product_id: 'OtherProductID',
                    name: 'OtherProductName',
                    price: 43,
                },
            ],
        },
    },
    {
        name: 'Product Added to Wishlist',
        properties: {
            product_id: 'SomeProductID',
            name: 'SomeProductName',
            price: 42,
            quantity: 1,
            wishlist_id: 'SomeWishlistID',
            wishlist_name: 'SomeWishlistName',
        },
    },
    {
        name: 'Order Completed',
        properties: {
            products: [
                {
                    product_id: 'SomeProductID',
                    name: 'SomeProductName',
                    price: 42,
                },
                {
                    product_id: 'OtherProductID',
                    name: 'OtherProductName',
                    price: 43,
                },
            ],
            total: 83,
            currency: 'USD',
        },
    },
    {
        name: 'Custom Event',
        properties: {
            foo: 'bar',
        },
    },
]

export default function Ecommerce() {
    const posthog = usePostHog()

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {events.map((event) => (
                <button key={event.name} onClick={() => posthog.capture(event.name, event.properties)}>
                    {event.name}
                </button>
            ))}
        </div>
    )
}
