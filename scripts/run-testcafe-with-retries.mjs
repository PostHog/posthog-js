import yargs from "yargs"

import {spawnSync} from "child_process"


const main = async () => {
  const argv= yargs(process.argv).argv
  const attempts = argv.attempts || 3
  const browser = argv.browser
  if (!browser) {
    throw new Error("Missing browser argument")
  }


  for (let i = 0; i < attempts; i++) {
    console.log(`Attempt ${i + 1} of a maximum of ${attempts} attempts`)
    const result = spawnSync("yarn", ["testcafe", browser], {stdio: "inherit"})
    if (result.status === 0) {
      console.log("Test succeeded")
      return
    }
    console.log("Test failed")
  }
  throw new Error(`Test failed after ${attempts} attempts`)
}


main().catch(e => {
  console.error(e)
  process.exit(1)
})
