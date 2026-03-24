import * as ftp from "basic-ftp"

async function example() {
    const client = new ftp.Client()
    try {
        await client.access({
            host: "ftpx.forpsi.com",
            user: "miss3cz",
            password: "87QvCdFWrD",
            secure: false
        })
        console.log("=== Root ===")
        console.log((await client.list()).map(f => f.name))
        console.log("=== www ===")
        console.log((await client.list("www")).map(f => f.name))
        console.log("=== subdoms ===")
        console.log((await client.list("subdoms")).map(f => f.name))
    }
    catch (err) {
        console.log(err)
    }
    client.close()
}

example()
