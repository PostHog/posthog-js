import { FormEventHandler, useState } from 'react'

const AutoCapture = () => {
    const handleClick: FormEventHandler = (e) => {
        e.preventDefault()
    }

    const [text, setText] = useState('')

    return (
        <div className="max-w-sm mx-auto space-y-4">
            <button
                type="button"
                className="font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center"
                data-ph-autocapture="button"
            >
                Regular button
            </button>

            <form
                onSubmit={handleClick}
                data-ph-capture-attribute-custom-property={'foo'}
                data-ph-capture-attribute-form-text={text}
            >
                <div className="mb-5">
                    <label htmlFor="text" className="block mb-2 text-sm font-medium">
                        Your text
                    </label>
                    <input
                        type="text"
                        id="text"
                        className="text-sm rounded-lg  block w-full p-2.5"
                        placeholder="Some text here..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                    />
                </div>
                <div className="mb-5">
                    <label htmlFor="password" className="block mb-2 text-sm font-medium">
                        Your password
                    </label>
                    <input
                        type="password"
                        id="password"
                        className="text-sm rounded-lg  block w-full p-2.5"
                        placeholder="Some password here..."
                    />
                </div>
                <button
                    type="submit"
                    className="font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center"
                >
                    Submit
                </button>
            </form>
        </div>
    )
}

export default AutoCapture
