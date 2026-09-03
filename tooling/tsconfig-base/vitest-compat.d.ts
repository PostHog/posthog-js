import type {
    Mocked as VitestMocked,
    MockedClass as VitestMockedClass,
    MockedFunction as VitestMockedFunction,
    SpyInstance as VitestSpyInstance,
} from 'vitest'

declare global {
    namespace vi {
        type Mock<Result = any, Args extends any[] = any[]> = VitestSpyInstance<Args, Result> &
            ((...args: Args) => Result)
        type SpyInstance<Result = any, Args extends any[] = any[]> = VitestSpyInstance<Args, Result>
        type Mocked<T> = VitestMocked<T>
        type MockedClass<T extends new (...args: any[]) => any> = VitestMockedClass<T>
        type MockedFunction<T extends (...args: any[]) => any> = VitestMockedFunction<T>
    }
}

export {}
