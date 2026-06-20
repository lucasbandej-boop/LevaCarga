require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_EMAIL = "admin@levacarga.com";
const ADMIN_PASSWORD = "LevaCargaAngola2026";

let drivers = [];
let pendingDrivers = [];
let activeFreights = [];
let freightHistory = [];

app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        res.json({ success: true, message: "Acesso autorizado!" });
    } else {
        res.json({ success: false, message: "E-mail ou Palavra-passe de administrador incorretos!" });
    }
});

// Rota para o Admin recarregar o saldo de um motorista ativo
app.post('/api/admin/recharge', (req, res) => {
    const { phone, amount } = req.body;
    const driver = drivers.find(d => d.phone === phone);
    
    if (driver) {
        driver.balance += parseInt(amount);
        // Notificar o motorista em tempo real sobre o novo saldo
        io.emit(`balance_updated_${driver.tempId}`, { newBalance: driver.balance });
        return res.json({ success: true, message: `Saldo de ${amount} Kz adicionado com sucesso ao motorista ${driver.name}!` });
    }
    res.json({ success: false, message: "Motorista ativo não encontrado com este número de telefone." });
});

app.post('/api/drivers/register', (req, res) => {
    const { name, bi, phone, email, vehicleType, licensePlate, password } = req.body;
    if (drivers.find(d => d.phone === phone)) {
        return res.json({ success: false, message: "Este número de telefone já está registado!" });
    }
    const tempId = 'drv_' + Math.random().toString(36).substring(2, 9);
    // Damos 5000 Kz de saldo inicial de oferta para ele começar a testar/trabalhar
    const newDriver = { tempId, name, bi, phone, email, vehicleType, licensePlate, password, approved: false, balance: 5000 };
    pendingDrivers.push(newDriver);
    io.emit('admin_reload_pending', pendingDrivers);
    res.json({ success: true, needsVerification: true, tempId });
});

app.post('/api/drivers/login', (req, res) => {
    const { phone, password } = req.body;
    const driver = drivers.find(d => d.phone === phone && d.password === password && d.approved === true);
    if (driver) {
        res.json({ success: true, driverId: driver.tempId, name: driver.name, balance: driver.balance });
    } else {
        const isPending = pendingDrivers.find(d => d.phone === phone);
        if (isPending) {
            res.json({ success: false, message: "A sua conta ainda está em análise pela administração." });
        } else {
            res.json({ success: false, message: "Dados incorretos ou operador não homologado." });
        }
    }
});

// Obter dados atualizados do motorista (como o saldo real)
app.get('/api/drivers/profile', (req, res) => {
    const { driverId } = req.query;
    const driver = drivers.find(d => d.tempId === driverId);
    if(driver) {
        res.json({ success: true, balance: driver.balance });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/admin/pending', (req, res) => {
    res.json(pendingDrivers);
});

app.post('/api/admin/approve', (req, res) => {
    const { tempId } = req.body;
    const index = pendingDrivers.findIndex(d => d.tempId === tempId);
    if (index !== -1) {
        let approvedDriver = pendingDrivers[index];
        approvedDriver.approved = true;
        drivers.push(approvedDriver);
        pendingDrivers.splice(index, 1);
        io.emit(`driver_approved_${tempId}`, { success: true, driverId: approvedDriver.tempId, name: approvedDriver.name });
        io.emit('admin_reload_pending', pendingDrivers);
        return res.json({ success: true, message: "Operador aprovado com sucesso!" });
    }
    res.json({ success: false, message: "Motorista não encontrado." });
});

app.get('/api/freights/history', (req, res) => {
    const { driverId } = req.query;
    if (driverId) {
        const filtrado = freightHistory.filter(f => f.driverId === driverId);
        return res.json(filtrado);
    }
    res.json(freightHistory);
});

io.on('connection', (socket) => {
    socket.on('update_location', (data) => {
        socket.broadcast.emit('driver_moved', data);
    });

    socket.on('new_freight_request', (data) => {
        let taxaBase = 2500;
        if(data.vehicleType === "Trisiclo de Carga") taxaBase = 3500;
        if(data.vehicleType === "Carro Normal") taxaBase = 4000;
        if(data.vehicleType === "Carrinha de Carga") taxaBase = 6500;
        if(data.vehicleType === "Camião Canter") taxaBase = 12000;
        if(data.vehicleType === "Camião Grande") taxaBase = 25000;

        const faturacaoTotal = taxaBase + " Kz";
        const ganhoMotorista = Math.round(taxaBase * 0.8) + " Kz";

        const novaOferta = { ...data, faturacao: faturacaoTotal, ganhoMotorista, distanceRoute: "Calculando...", taxaBrutaNum: taxaBase };
        activeFreights.push(novaOferta);
        socket.broadcast.emit('freight_offer', novaOferta);
    });

    socket.on('update_status_corrida', (data) => {
        io.emit('status_changed', data);
        
        // Quando a corrida é concluída, descontamos os 20% do saldo do motorista
        if(data.novoStatus === 'concluido' && data.driverId) {
            const driver = drivers.find(d => d.tempId === data.driverId);
            if(driver) {
                const taxaBruta = parseInt(data.faturacao.replace(/[^0-9]/g, '')) || 0;
                const comissaoEmpresa = Math.round(taxaBruta * 0.20);
                
                // Descontar a comissão do saldo pré-pago do motorista
                driver.balance -= comissaoEmpresa;
                
                // Notificar a app do motorista para atualizar o saldo no ecrã dele
                io.emit(`balance_updated_${driver.tempId}`, { newBalance: driver.balance });
            }
            freightHistory.push(data);
        }
    });

    socket.on('driver_position_moved', (data) => {
        io.emit('live_driver_moved', data);
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('🚀 LEVACARGA OPERACIONAL EM: https://levacarga.vercel.app');
});
