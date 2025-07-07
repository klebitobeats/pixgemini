// api/create-pix-payment.js
// Esta é uma função Serverless para Vercel.

// Importe o SDK do Mercado Pago
const mercadopago = require('mercadopago');

// NÃO INSTANCIAR: O SDK do Mercado Pago é um objeto direto, não uma classe.
// const mp = new mercadopago(); // Linha removida/comentada

// Configure suas credenciais do Mercado Pago usando variáveis de ambiente da Vercel.
// MERCADO_PAGO_ACCESS_TOKEN = SEU_ACCESS_TOKEN_AQUI
mercadopago.configure({ // <--- CORREÇÃO AQUI: Chama configure diretamente no objeto mercadopago
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Importa o Firebase Admin SDK para interagir com o Firestore
const admin = require('firebase-admin');

let db; // Variável para a instância do Firestore

// Inicializa o Firebase Admin SDK (se ainda não estiver inicializado)
if (!admin.apps.length) {
    try {
        console.log("Tentando inicializar Firebase Admin SDK...");
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore(); // Atribui a instância do Firestore após a inicialização bem-sucedida
        console.log("Firebase Admin SDK inicializado com sucesso.");
    } catch (error) {
        console.error("ERRO CRÍTICO: Falha ao inicializar Firebase Admin SDK:", error);
        // Em um ambiente de produção, é crucial que esta parte funcione.
        // Se a inicialização falhar, as operações subsequentes do Firestore também falharão.
        // Retornamos um erro 500 imediatamente para o cliente.
        // Não podemos usar 'db' aqui, pois ele pode não ter sido inicializado.
        module.exports = async (req, res) => {
            return res.status(500).json({ error: 'Erro de configuração do servidor (Firebase Admin SDK).', details: error.message });
        };
        return; // Sai da execução para evitar que o código continue com um SDK não inicializado
    }
} else {
    // Se já estiver inicializado, apenas obtém a instância do Firestore
    db = admin.firestore();
    console.log("Firebase Admin SDK já estava inicializado.");
}


module.exports = async (req, res) => {
    console.log("Requisição recebida para create-pix-payment.");
    
    // Verifica se o Firebase Admin SDK está inicializado antes de prosseguir
    if (!db) {
        console.error("Firebase Admin SDK não inicializado ou Firestore indisponível no fluxo principal.");
        return res.status(500).json({ error: "Serviço de banco de dados indisponível. Tente novamente mais tarde." });
    }

    if (req.method !== 'POST') {
        console.log("Método não permitido:", req.method);
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    const { orderId, userId, amount } = req.body;
    console.log("Dados recebidos:", { orderId, userId, amount });

    if (!orderId || !userId || !amount) {
        console.error("Dados obrigatórios ausentes:", { orderId, userId, amount });
        return res.status(400).json({ error: 'ID do pedido, ID do usuário e valor são obrigatórios.' });
    }

    // Define o APP_ID com base no projectId do seu Firebase (appfuncional-47d81)
    const APP_ID = 'appfuncional-47d81'; // Hardcoded conforme seu Firebase projectId
    console.log("APP_ID:", APP_ID);

    let orderDetails;
    try {
        console.log(`Buscando detalhes do pedido ${orderId} para o usuário ${userId}...`);
        const orderDocRef = db.collection('artifacts').doc(APP_ID).collection('users').doc(userId).collection('orders').doc(orderId);
        const orderDoc = await orderDocRef.get();

        if (!orderDoc.exists) {
            console.error(`Pedido ${orderId} não encontrado para o usuário ${userId}.`);
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }
        orderDetails = orderDoc.data();
        console.log("Detalhes do pedido buscados do Firestore:", orderDetails);

    } catch (firestoreError) {
        console.error("Erro ao buscar detalhes do pedido no Firestore:", firestoreError);
        return res.status(500).json({ error: 'Falha ao buscar detalhes do pedido.' });
    }

    try {
        // Verifica se orderDetails.items existe e é um array antes de tentar mapear
        const itemsDescription = orderDetails.items && Array.isArray(orderDetails.items)
            ? orderDetails.items.map(item => `${item.name} (x${item.quantity})`).join(', ')
            : 'Itens não especificados'; // Fallback se items não for um array válido

        const description = `Pedido de Açaí #${orderId.substring(0, 8)} - Itens: ${itemsDescription}`;
        console.log("Descrição do pagamento:", description);

        const preference = {
            transaction_amount: parseFloat(amount),
            description: description,
            external_reference: orderId,
            payment_method_id: 'pix',
            payer: {
                email: orderDetails.email || 'pagador_anonimo@email.com',
            },
            metadata: {
                userId: userId,
                orderId: orderId,
                address: orderDetails.address,
                phone: orderDetails.phone,
            },
            back_urls: {
                success: `https://indexazai.vercel.app/#orders?status=aprovado&orderId=${orderId}`,
                pending: `https://indexazai.vercel.app/#orders?status=pendente&orderId=${orderId}`,
                failure: `https://indexazai.vercel.app/#orders?status=nao_aprovado&orderId=${orderId}`
            },
            notification_url: `https://pixgemini.vercel.app/api/mercado-pago-webhook`,
            auto_return: 'all',
        };
        console.log("Preferência do Mercado Pago criada:", preference);

        console.log("Tentando criar preferência de pagamento no Mercado Pago...");
        // <--- CORREÇÃO AQUI: Chama preferences.create diretamente no objeto mercadopago
        const response = await mercadopago.preferences.create(preference); 
        console.log("RESPOSTA COMPLETA DO MERCADO PAGO:", JSON.stringify(response, null, 2)); // Log da resposta completa
        const pixData = response.body;
        console.log("Corpo da resposta do Mercado Pago (pixData):", pixData);

        // Verifica se os dados necessários para o Pix existem na resposta
        if (!pixData || !pixData.point_of_interaction || !pixData.point_of_interaction.transaction_data) {
            console.error("Estrutura de resposta do Mercado Pago inesperada:", pixData);
            return res.status(500).json({ error: 'Resposta inesperada do Mercado Pago ao gerar Pix.' });
        }

        const qrCodeBase64 = pixData.point_of_interaction.transaction_data.qr_code_base64;
        const pixCode = pixData.point_of_interaction.transaction_data.qr_code;

        res.status(200).json({ qrCodeBase64, pixCode, orderId, userId });
        console.log("Resposta enviada com sucesso.");

    } catch (error) {
        console.error('ERRO GERAL NO FLUXO DE PAGAMENTO PIX:', error.response ? error.response.data : error.message);
        // Tenta atualizar o status do pedido no Firestore para indicar falha
        try {
            console.log("Tentando atualizar status do pedido no Firestore para 'Erro na Geração Pix'...");
            const orderDocRef = db.collection('artifacts').doc(APP_ID).collection('users').doc(userId).collection('orders').doc(orderId);
            await orderDocRef.update({
                status: 'Erro na Geração Pix',
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                errorMessage: error.message // Salva a mensagem de erro para depuração
            });
            console.log(`Status do pedido ${orderId} do usuário ${userId} atualizado para 'Erro na Geração Pix' no Firestore.`);
        } catch (firestoreError) {
            console.error("Erro ao atualizar Firestore após falha na criação do Pix:", firestoreError);
        }

        res.status(500).json({ error: 'Falha ao processar o pagamento Pix. Tente novamente mais tarde.' });
    }
};
