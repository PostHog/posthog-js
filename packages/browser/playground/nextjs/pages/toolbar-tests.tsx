export default function ToolbarTests() {
    return (
        <div className="flex flex-col gap-2">
            <h1>Toolbar Tests</h1>
            <div>
                <h2>Element selector needs to cope based on z-index</h2>
                <div className="border rounded relative z-5 w-64 h-64">
                    <button
                        className="absolute top-0 left-0 h-full w-full"
                        aria-label="this button is postioned on top of the other children here"
                    ></button>
                    <div>Row 1</div>
                    <div>Row 2</div>

                    <button className="absolute left-0 bottom-0">button 1</button>
                    <button className="z-10 absolute right-0 bottom-0">button 2</button>
                </div>
            </div>
        </div>
    )
}
