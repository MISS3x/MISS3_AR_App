import * as ftp from "basic-ftp"

async function deploy() {
    const client = new ftp.Client()
    client.ftp.verbose = true
    try {
        await client.access({
            host: "ftpx.forpsi.com",
            user: "miss3cz",
            password: "87QvCdFWrD",
            secure: false
        })

        await client.ensureDir("subdoms/virtual/bbg")
        await client.clearWorkingDir()
        await client.uploadFromDir("dist")
        console.log("Upload to subdoms/virtual/bbg complete!")
    }
    catch (err) {
        console.log(err)
    }
    client.close()
}

deploy()
