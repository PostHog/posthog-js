import { serialize } from 'cookie'
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    const sessionData = req.body
    const encryptedSessionData = JSON.stringify(sessionData)

    const cookie = serialize('session', encryptedSessionData, {
        httpOnly: false,
        secure: false,
        maxAge: 60 * 60 * 24 * 7, // One week
        path: '/',
    })
    res.setHeader('Set-Cookie', cookie)
    res.status(200).json({ message: 'Successfully set cookie!' })
}
