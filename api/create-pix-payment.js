// api/create-pix-payment.js
// Esta é uma função Serverless para Vercel.
// VERSÃO DE TESTE: APENAS PARA DEPURAR A INICIALIZAÇÃO DO FIREBASE ADMIN SDK

const admin = require('firebase-admin');

module.exports = async (req, res) => {
    console.log("Iniciando teste de inicialização do Firebase Admin SDK...");

    if (admin.apps.length) {
        console.log("Firebase Admin SDK já estava inicializado.");
        return res.status(200).json({ status: 'success', message: 'Firebase Admin SDK já inicializado.' });
    }

    try {
        console.log("Tentando inicializar Firebase Admin SDK com FIREBASE_SERVICE_ACCOUNT_KEY...");
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK inicializado com sucesso.");
        return res.status(200).json({ status: 'success', message: 'Firebase Admin SDK inicializado com sucesso.' });
    } catch (error) {
        console.error("ERRO CRÍTICO NO TESTE: Falha ao inicializar Firebase Admin SDK:", error.message);
        // Retorna um erro 500 com detalhes para o cliente
        return res.status(500).json({ status: 'error', message: 'Erro de configuração do servidor (Firebase Admin SDK).', details: error.message });
    }
};
