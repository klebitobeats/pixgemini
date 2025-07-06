// api/create-pix-payment.js
// Esta é uma função Serverless para Vercel.

// Importe o SDK do Mercado Pago ou do seu gateway de pagamento aqui.
// Exemplo para Mercado Pago:
const mercadopago = require('mercadopago');

// Configure suas credenciais do Mercado Pago usando variáveis de ambiente da Vercel.
// No Vercel, vá em "Settings" -> "Environment Variables" e adicione:
// MERCADO_PAGO_ACCESS_TOKEN = SEU_ACCESS_TOKEN_AQUI
mercadopago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Importa o Firebase Admin SDK para interagir com o Firestore (para atualizar o status do pedido)
// ATENÇÃO: Você precisará configurar as credenciais do Firebase Admin SDK como variáveis de ambiente na Vercel.
// Crie um arquivo JSON de chave privada para sua conta de serviço do Firebase,
// e adicione o conteúdo como uma única string (JSON.stringify) em uma variável de ambiente, por exemplo, FIREBASE_SERVICE_ACCOUNT_KEY
// Ou configure as variáveis individuais (PROJECT_ID, PRIVATE_KEY, CLIENT_EMAIL)
const admin = require('firebase-admin');

// Inicializa o Firebase Admin SDK (se ainda não estiver inicializado)
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Erro ao inicializar Firebase Admin SDK:", error);
        // Em um ambiente de produção, você pode querer um tratamento de erro mais robusto aqui.
    }
}
const db = admin.firestore(); // Obtém a instância do Firestore

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    const { valor, id_pedido, endereco, observacoes, whatsapp, userEmail } = req.body;

    if (!valor || !id_pedido) {
        return res.status(400).json({ error: 'Valor e ID do pedido são obrigatórios.' });
    }

    try {
        // Objeto de preferência de pagamento para o Mercado Pago
        const preference = {
            transaction_amount: parseFloat(valor),
            description: `Pedido appaçaí #${id_pedido}`,
            external_reference: id_pedido, // Usar o ID do pedido como referência externa
            payment_method_id: 'pix',
            payer: {
                email: userEmail || 'pagador_anonimo@email.com', // Email do usuário ou um placeholder
            },
            // Adicione os dados do endereço e observações para referência no Mercado Pago, se suportado
            // (Mercado Pago tem campos limitados para isso diretamente na preferência de pagamento PIX)
            // Você pode adicionar em metadata se o seu plano/integração permitir.
            metadata: {
                endereco: endereco, // Objeto de endereço
                observacoes: observacoes,
                whatsapp: whatsapp,
                userEmail: userEmail
            },
            // URLs de retorno após o pagamento (podem ser a mesma página do app principal)
            back_urls: {
                success: `https://seu-app-principal.vercel.app/my-orders?status_pagamento=aprovado&id_pedido=${id_pedido}`,
                pending: `https://seu-app-principal.vercel.app/my-orders?status_pagamento=pendente&id_pedido=${id_pedido}`,
                failure: `https://seu-app-principal.vercel.app/my-orders?status_pagamento=nao_aprovado&id_pedido=${id_pedido}`
            },
            notification_url: `https://pixgemini.vercel.app/api/mercado-pago-webhook`, // URL do seu webhook na Vercel
            auto_return: 'all', // Redireciona o usuário automaticamente
        };

        // Cria a preferência de pagamento no Mercado Pago
        const response = await mercadopago.preferences.create(preference);
        const pixData = response.body;

        // Extrai o QR Code e o código copia e cola
        const qrCodeBase64 = pixData.point_of_interaction.transaction_data.qr_code_base64;
        const pixCode = pixData.point_of_interaction.transaction_data.qr_code;

        // Retorna os dados do Pix para o cliente
        res.status(200).json({ qrCodeBase64, pixCode, id_pedido });

    } catch (error) {
        console.error('Erro ao criar pagamento Pix:', error.response ? error.response.data : error.message);
        // Em caso de erro, atualiza o status do pedido no Firestore para indicar falha na geração do Pix
        try {
            const appId = process.env.FIREBASE_PROJECT_ID || 'appv-ec0aa'; // Usar o Project ID do Firebase Admin
            // O userId não é diretamente conhecido aqui, mas o id_pedido é.
            // Para atualizar o pedido do usuário específico, você precisaria do userId.
            // Uma solução seria passar o userId como parte do metadata para o Mercado Pago
            // e recuperá-lo no webhook, ou ter uma coleção de pedidos públicos que o webhook pode atualizar.
            // Por enquanto, vamos atualizar apenas a coleção pública e logar o erro.

            // ATENÇÃO: Se você precisar atualizar o pedido específico do usuário,
            // o `create-pix-payment.js` precisaria receber o `userId` do app principal
            // e passá-lo para o webhook via `metadata` ou similar no Mercado Pago.
            // Por simplicidade, aqui, vamos assumir que o webhook pode encontrar o pedido pelo `id_pedido`
            // na coleção pública e, a partir daí, inferir o userId (se o pedido contiver o userId).
            
            // Se o pedido já foi salvo no app principal como 'Aguardando Pagamento PIX',
            // podemos atualizá-lo para 'Erro na Geração Pix'
            const publicOrderDocRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('all_orders').doc(id_pedido);
            await publicOrderDocRef.update({ 
                status: 'Erro na Geração Pix',
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                errorMessage: error.message // Salva a mensagem de erro para depuração
            });
            console.log(`Status do pedido ${id_pedido} atualizado para 'Erro na Geração Pix' no Firestore.`);
        } catch (firestoreError) {
            console.error("Erro ao atualizar Firestore após falha na criação do Pix:", firestoreError);
        }

        res.status(500).json({ error: 'Falha ao processar o pagamento Pix. Tente novamente mais tarde.' });
    }
};
