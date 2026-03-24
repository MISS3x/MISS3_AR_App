async function testEmail() {
    const url = 'http://81.2.195.79/garaze/api/contact.php';
    const payload = {
        firstName: 'Test',
        lastName: 'Zákazník',
        email: 'test@miss3.cz',
        phone: '+420 111 222 333',
        message: 'Toto je testovací poptávka z konfigurátoru (automatický test, můžete smazat).',
        config: {
            garageType: 'double',
            width: 6.5,
            depth: 5.8,
            facadeMaterial: 'wood',
            doorColor: '#1a1a1a',
            addWindow: true
        },
        totalPrice: 120000
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Host': 'miss3.cz'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('Status (miss3.cz):', response.status);
        console.log('Response:', text);
    } catch (error) {
        console.error('Error fetching miss3.cz:', error);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Host': 'www.miss3.cz'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('\nStatus (www.miss3.cz):', response.status);
        console.log('Response:', text);
    } catch (error) {
        console.error('Error fetching www.miss3.cz:', error);
    }
}

testEmail();
