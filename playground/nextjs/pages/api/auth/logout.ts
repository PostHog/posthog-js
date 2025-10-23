import { serialize } from 'cookie'
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    const cookie = serialize('session', '', {
        httpOnly: false,
        secure: false,
        maxAge: 1, // One week
        path: '/',
    })
    res.setHeader('Set-Cookie', cookie)
    res.status(200).json({ message: 'Successfully cleared cookie!' })
}
