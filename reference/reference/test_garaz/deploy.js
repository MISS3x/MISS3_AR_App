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
        console.log("Connected to FTP. Uploading dist folder...");
        await client.ensureDir("/subdoms/virtual/bbg");
        await client.uploadFromDir("dist");
        console.log("Upload successful!");
    }
    catch (err) {
        console.log("FTP Error:", err)
    }
    client.close()
}

deploy()
