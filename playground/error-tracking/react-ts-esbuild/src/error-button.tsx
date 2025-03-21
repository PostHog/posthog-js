function throwException() {
    throw new Error('Exception created')
}

export default function ErrorButton() {
    return <button onClick={() => throwException()}>Create exception</button>
}
