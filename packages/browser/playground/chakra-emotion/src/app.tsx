import { Box, Card, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react'

export default function App() {
    return (
        <Flex
            minH="100vh"
            align="center"
            justify="center"
            bg="gray.50"
            p={8}
            // exposed so a playwright spec can find this element
            data-cy-root
        >
            <Card.Root
                p={8}
                maxW="420px"
                w="full"
                borderRadius="2xl"
                borderWidth="1px"
                borderColor="brand.50"
                bg="white"
                shadow="lg"
                data-cy-card
            >
                <Stack gap={6}>
                    <Heading size="lg">Sign in</Heading>
                    <Text color="gray.500">
                        This card has p=8 (32px) padding on all sides. If the replay shows the inputs flush left,
                        the rule.cssText round-trip is dropping longhand padding values.
                    </Text>
                    <Box>
                        <Text mb={2}>Email</Text>
                        <Input data-cy-input placeholder="you@example.com" />
                    </Box>
                </Stack>
            </Card.Root>
        </Flex>
    )
}
