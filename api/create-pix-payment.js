// api/create-pix-payment.js
// Esta é uma função Serverless para Vercel.

// Importe o SDK do Mercado Pago
const mercadopago = require('mercadopago');

// Instancie o SDK do Mercado Pago antes de configurar
const mp = new mercadopago(); // <--- CORREÇÃO AQUI: Instancia a classe MercadoPago

// Configure suas credenciais do Mercado Pago usando variáveis de ambiente da Vercel.
// MERCADO_PAGO_ACCESS_TOKEN = SEU_ACCESS_TOKEN_AQUI
mp.configure({ // <--- CORREÇÃO AQUI: Chama configure na instância 'mp'
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Importa o Firebase Admin SDK para interagir com o Firestore
const admin = require('firebase-admin');

// Inicializa o Firebase Admin SDK (se ainda não estiver inicializado)
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Erro ao inicializar Firebase Admin SDK em create-pix-payment:", error);
        // Em um ambiente de produção, é crucial que esta parte funcione.
    }
}
const db = admin.firestore(); // Obtém a instância do Firestore

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    // Recebe os parâmetros do seu aplicativo HTML (via POST do Vercel checkout page)
    const { orderId, userId, amount } = req.body;

    if (!orderId || !userId || !amount) {
        return res.status(400).json({ error: 'ID do pedido, ID do usuário e valor são obrigatórios.' });
    }

    // Verifica se o Firebase Admin SDK está inicializado
    if (!admin.apps.length || !db) {
        console.error("Firebase Admin SDK não inicializado ou Firestore indisponível.");
        return res.status(500).json({ error: "Serviço de banco de dados indisponível. Tente novamente mais tarde." });
    }

    // Define o APP_ID com base no projectId do seu Firebase (appfuncional-47d81)
    const APP_ID = 'appfuncional-47d81'; // Hardcoded conforme seu Firebase projectId

    let orderDetails;
    try {
        // 1. Busca os detalhes completos do pedido no Firestore
        // Isso garante que temos todas as informações (itens, endereço, telefone, etc.)
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
        // Constrói a descrição do pagamento com base nos itens do pedido
        const description = `Pedido de Açaí #${orderId.substring(0, 8)} - Itens: ${orderDetails.items.map(item => `${item.name} (x${item.quantity})`).join(', ')}`;

        // Objeto de preferência de pagamento para o Mercado Pago
        const preference = {
            transaction_amount: parseFloat(amount),
            description: description,
            external_reference: orderId, // Usar o ID do pedido como referência externa
            payment_method_id: 'pix',
            payer: {
                email: orderDetails.email || 'pagador_anonimo@email.com', // Email do usuário do pedido ou um placeholder
            },
            // CRUCIAL: Passa o userId no metadata para o webhook poder identificar o usuário
            metadata: {
                userId: userId,
                orderId: orderId, // Redundante, mas útil para depuração
                address: orderDetails.address,
                phone: orderDetails.phone,
                // Você pode adicionar outros detalhes do pedido aqui se precisar no webhook
            },
            // URLs de retorno após o pagamento (redireciona para a página de pedidos do seu app principal)
            back_urls: {
                success: `https://indexazai.vercel.app/#orders?status=aprovado&orderId=${orderId}`,
                pending: `https://indexazai.vercel.app/#orders?status=pendente&orderId=${orderId}`,
                failure: `https://indexazai.vercel.app/#orders?status=nao_aprovado&orderId=${orderId}`
            },
            // URL do seu webhook na Vercel para receber notificações de pagamento
            notification_url: `https://pixgemini.vercel.app/api/mercado-pago-webhook`,
            auto_return: 'all', // Redireciona o usuário automaticamente
        };

        // Cria a preferência de pagamento no Mercado Pago
        const response = await mp.preferences.create(preference); // <--- CORREÇÃO AQUI: Chama create na instância 'mp'
        const pixData = response.body;

        // Extrai o QR Code e o código copia e cola
        const qrCodeBase64 = pixData.point_of_interaction.transaction_data.qr_code_base64;
        const pixCode = pixData.point_of_interaction.transaction_data.qr_code;

        // Retorna os dados do Pix para o cliente (sua página de checkout no Vercel)
        res.status(200).json({ qrCodeBase64, pixCode, orderId, userId });

    } catch (error) {
        console.error('Erro ao criar pagamento Pix:', error.response ? error.response.data : error.message);
        // Em caso de erro, atualiza o status do pedido no Firestore para indicar falha
        try {
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
