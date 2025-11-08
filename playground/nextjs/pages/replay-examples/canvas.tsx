import React from 'react'
import { useEffect, useRef } from 'react'

function Starfield2D() {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        if (ref.current) {
            const canvas = ref.current
            const context = canvas.getContext('2d')

            if (canvas && context) {
                const numStars = 1000
                const radius = 1
                let focalLength = canvas.width

                let centerX = 0
                let centerY = 0

                let stars: { x: number; y: number; z: number }[] = []
                let star = null
                let i = 0

                let animate = false

                const executeFrame = () => {
                    if (animate) requestAnimationFrame(executeFrame)
                    moveStars()
                    drawStars()
                }

                const initializeStars = () => {
                    centerX = canvas.width / 2
                    centerY = canvas.height / 2

                    stars = []
                    for (i = 0; i < numStars; i++) {
                        star = {
                            x: Math.random() * canvas.width,
                            y: Math.random() * canvas.height,
                            z: Math.random() * canvas.width,
                        }
                        stars.push(star)
                    }
                }

                const moveStars = () => {
                    for (i = 0; i < numStars; i++) {
                        star = stars[i]
                        star.z--

                        if (star.z <= 0) {
                            star.z = canvas.width
                        }
                    }
                }

                const drawStars = () => {
                    let pixelX = 0
                    let pixelY = 0
                    let pixelRadius = 0

                    if (canvas.width != window.innerWidth || canvas.width != window.innerWidth) {
                        canvas.width = window.innerWidth
                        canvas.height = window.innerHeight
                        initializeStars()
                    }

                    context.fillStyle = 'black'
                    context.fillRect(0, 0, canvas.width, canvas.height)
                    context.fillStyle = 'white'
                    for (i = 0; i < numStars; i++) {
                        star = stars[i]

                        pixelX = (star.x - centerX) * (focalLength / star.z)
                        pixelX += centerX
                        pixelY = (star.y - centerY) * (focalLength / star.z)
                        pixelY += centerY
                        pixelRadius = radius * (focalLength / star.z)

                        context.beginPath()
                        context.arc(pixelX, pixelY, pixelRadius, 0, 2 * Math.PI)
                        context.fill()
                    }
                }

                canvas.addEventListener(
                    'mousemove',
                    function (e) {
                        focalLength = e.x
                    },
                    { passive: true }
                )

                canvas.addEventListener(
                    'mouseover',
                    function () {
                        animate = true
                        executeFrame()
                    },
                    { passive: true }
                )

                canvas.addEventListener(
                    'mouseout',
                    function () {
                        animate = false
                    },
                    { passive: true }
                )

                initializeStars()
                executeFrame()
            }
        }
    }, [])

    return <canvas ref={ref} style={{ width: '200px', height: '200px', display: 'block' }}></canvas>
}

function RotatingCubeWebGL() {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        if (!ref.current) return

        const canvas = ref.current
        const gl = canvas.getContext('webgl')

        if (!gl) {
            console.error('WebGL not supported')
            return
        }

        const vertexShaderSource = `
            attribute vec4 aVertexPosition;
            attribute vec4 aVertexColor;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying lowp vec4 vColor;
            void main(void) {
                gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
                vColor = aVertexColor;
            }
        `

        const fragmentShaderSource = `
            varying lowp vec4 vColor;
            void main(void) {
                gl_FragColor = vColor;
            }
        `

        const createShader = (type: number, source: string) => {
            const shader = gl.createShader(type)
            if (!shader) return null
            gl.shaderSource(shader, source)
            gl.compileShader(shader)
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Shader compilation error:', gl.getShaderInfoLog(shader))
                gl.deleteShader(shader)
                return null
            }
            return shader
        }

        const vertexShader = createShader(gl.VERTEX_SHADER, vertexShaderSource)
        const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentShaderSource)

        if (!vertexShader || !fragmentShader) return

        const shaderProgram = gl.createProgram()
        if (!shaderProgram) return

        gl.attachShader(shaderProgram, vertexShader)
        gl.attachShader(shaderProgram, fragmentShader)
        gl.linkProgram(shaderProgram)

        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            console.error('Program linking error:', gl.getProgramInfoLog(shaderProgram))
            return
        }

        const programInfo = {
            program: shaderProgram,
            attribLocations: {
                vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
                vertexColor: gl.getAttribLocation(shaderProgram, 'aVertexColor'),
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
                modelViewMatrix: gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
            },
        }

        const positions = [
            -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
            -1.0, 1.0, -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, -1.0, -1.0, -1.0,
            1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
            -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0,
        ]

        const positionBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

        const faceColors = [
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, 1.0],
            [1.0, 1.0, 0.0, 1.0],
            [1.0, 0.0, 1.0, 1.0],
            [0.0, 1.0, 1.0, 1.0],
        ]

        let colors: number[] = []
        for (let i = 0; i < faceColors.length; i++) {
            const c = faceColors[i]
            colors = colors.concat(c, c, c, c)
        }

        const colorBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW)

        const indices = [
            0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20,
            21, 22, 20, 22, 23,
        ]

        const indexBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW)

        let rotation = 0
        let animate = true

        const drawScene = () => {
            gl.clearColor(0.0, 0.0, 0.0, 1.0)
            gl.clearDepth(1.0)
            gl.enable(gl.DEPTH_TEST)
            gl.depthFunc(gl.LEQUAL)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

            const fieldOfView = (45 * Math.PI) / 180
            const aspect = canvas.clientWidth / canvas.clientHeight
            const zNear = 0.1
            const zFar = 100.0
            const projectionMatrix = mat4Create()
            mat4Perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar)

            const modelViewMatrix = mat4Create()
            mat4Translate(modelViewMatrix, modelViewMatrix, [0.0, 0.0, -6.0])
            mat4RotateX(modelViewMatrix, modelViewMatrix, rotation)
            mat4RotateY(modelViewMatrix, modelViewMatrix, rotation * 0.7)

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
            gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0)
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition)

            gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
            gl.vertexAttribPointer(programInfo.attribLocations.vertexColor, 4, gl.FLOAT, false, 0, 0)
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor)

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)

            gl.useProgram(programInfo.program)

            gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix)
            gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix)

            gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)

            if (animate) {
                rotation += 0.01
                requestAnimationFrame(drawScene)
            }
        }

        canvas.addEventListener(
            'mouseover',
            () => {
                animate = true
                drawScene()
            },
            { passive: true }
        )

        canvas.addEventListener(
            'mouseout',
            () => {
                animate = false
            },
            { passive: true }
        )

        drawScene()
    }, [])

    return (
        <canvas
            ref={ref}
            width={200}
            height={200}
            style={{ width: '200px', height: '200px', display: 'block' }}
        ></canvas>
    )
}

function mat4Create(): Float32Array {
    const out = new Float32Array(16)
    out[0] = 1
    out[5] = 1
    out[10] = 1
    out[15] = 1
    return out
}

function mat4Perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number) {
    const f = 1.0 / Math.tan(fovy / 2)
    out[0] = f / aspect
    out[1] = 0
    out[2] = 0
    out[3] = 0
    out[4] = 0
    out[5] = f
    out[6] = 0
    out[7] = 0
    out[8] = 0
    out[9] = 0
    out[11] = -1
    out[12] = 0
    out[13] = 0
    out[15] = 0
    if (far != null && far !== Infinity) {
        const nf = 1 / (near - far)
        out[10] = (far + near) * nf
        out[14] = 2 * far * near * nf
    } else {
        out[10] = -1
        out[14] = -2 * near
    }
}

function mat4Translate(out: Float32Array, a: Float32Array, v: number[]) {
    const x = v[0],
        y = v[1],
        z = v[2]
    out[12] = a[0] * x + a[4] * y + a[8] * z + a[12]
    out[13] = a[1] * x + a[5] * y + a[9] * z + a[13]
    out[14] = a[2] * x + a[6] * y + a[10] * z + a[14]
    out[15] = a[3] * x + a[7] * y + a[11] * z + a[15]
}

function mat4RotateX(out: Float32Array, a: Float32Array, rad: number) {
    const s = Math.sin(rad)
    const c = Math.cos(rad)
    const a10 = a[4]
    const a11 = a[5]
    const a12 = a[6]
    const a13 = a[7]
    const a20 = a[8]
    const a21 = a[9]
    const a22 = a[10]
    const a23 = a[11]

    out[4] = a10 * c + a20 * s
    out[5] = a11 * c + a21 * s
    out[6] = a12 * c + a22 * s
    out[7] = a13 * c + a23 * s
    out[8] = a20 * c - a10 * s
    out[9] = a21 * c - a11 * s
    out[10] = a22 * c - a12 * s
    out[11] = a23 * c - a13 * s
}

function mat4RotateY(out: Float32Array, a: Float32Array, rad: number) {
    const s = Math.sin(rad)
    const c = Math.cos(rad)
    const a00 = a[0]
    const a01 = a[1]
    const a02 = a[2]
    const a03 = a[3]
    const a20 = a[8]
    const a21 = a[9]
    const a22 = a[10]
    const a23 = a[11]

    out[0] = a00 * c - a20 * s
    out[1] = a01 * c - a21 * s
    out[2] = a02 * c - a22 * s
    out[3] = a03 * c - a23 * s
    out[8] = a00 * s + a20 * c
    out[9] = a01 * s + a21 * c
    out[10] = a02 * s + a22 * c
    out[11] = a03 * s + a23 * c
}

export default function Canvas() {
    return (
        <>
            <h1>Canvas Examples</h1>

            <section style={{ marginBottom: '2rem' }}>
                <h2>2D Canvas - Starfield</h2>
                <p>Hover to animate. Move mouse to adjust focal length.</p>
                <Starfield2D />
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>WebGL Canvas - Rotating Cube</h2>
                <p>Hover to animate the cube.</p>
                <RotatingCubeWebGL />
            </section>
        </>
    )
}
