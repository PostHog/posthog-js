import express, { Request, Response } from 'express'
import bodyParser from 'body-parser'
const PORT = process.env.PORT || 8000

export interface MockRequest {
  method: string
  path: string
  headers: any
  body: any
  params: any
}

export const createMockServer = (): [any, jest.Mock<MockRequest, any>] => {
  let app = express()
  app.use(bodyParser.urlencoded())

  let httpMock = jest.fn()

  const handleRequest = (req: Request, res: Response) => {
    const data: MockRequest = {
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
      params: req.params,
    }
    res.json(httpMock(data) || { status: 'ok' })
  }

  app.get('*', handleRequest)
  app.post('*', handleRequest)

  let server = app.listen(PORT)
  console.log(`Mock PostHog server listening at ${PORT}`)

  return [server, httpMock]
}
