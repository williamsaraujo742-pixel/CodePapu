const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Importamos bcrypt
const pool = require('./db');

const app = express();
app.use(express.json({ limit: '5mb' })); // Límite alto para la firma
app.use(cors());
// Servir archivos estáticos de la carpeta frontend
// Servir archivos estáticos con ruta ABSOLUTA




app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/admin/matriz', async (req, res) => {
    try {
        // Usamos LEFT JOIN para que traiga empleados aunque no tengan progreso o cursos
        const query = `
           SELECT 
    u.nombre AS empleado, 
    u.email AS email,  -- <-- AGREGAMOS ESTO
    COALESCE(c.titulo, 'Sin curso asignado') AS curso, 
    COALESCE(p.estado, 'Pendiente') AS estado,
    p.curso_id AS curso_id -- <-- AGREGAMOS EL ID DEL CURSO PARA ASIGNAR
FROM usuarios u
LEFT JOIN progreso_capacitacion p ON p.usuario_id = u.id
LEFT JOIN cursos c ON c.id = p.curso_id
WHERE u.rol = 'empleado'
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}); 


// RUTA PARA ASIGNAR UN CURSO A UN EMPLEADO
app.post('/api/admin/asignar', async (req, res) => {
    const { email_empleado, curso_id } = req.body;
    try {
        // 1. Buscamos el ID del empleado por su email
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email_empleado]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Empleado no encontrado' });
        }
        const usuario_id = userRes.rows[0].id;

        // 2. Insertamos o actualizamos el progreso
        const existe = await pool.query(
            'SELECT id FROM progreso_capacitacion WHERE usuario_id = $1 AND curso_id = $2',
            [usuario_id, curso_id]
        );

        if (existe.rows.length > 0) {
            // Si ya existe, lo ponemos en 'En Curso'
            await pool.query(
                'UPDATE progreso_capacitacion SET estado = $1 WHERE usuario_id = $2 AND curso_id = $3',
                ['En Curso', usuario_id, curso_id]
            );
        } else {
            // Si no existe, lo creamos
            await pool.query(
                'INSERT INTO progreso_capacitacion (usuario_id, curso_id, estado) VALUES ($1, $2, $3)',
                [usuario_id, curso_id, 'En Curso']
            );
        }

        res.json({ success: true, message: 'Curso asignado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// RUTA DE REGISTRO (Para crear usuarios con contraseña encriptada)
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const nuevo = await pool.query(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol',
            [nombre, email, passwordHash, rol]
        );
        res.json({ success: true, usuario: nuevo.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RUTA DE LOGIN (Comparando el hash)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
        const usuario = result.rows[0];
        const passwordValida = await bcrypt.compare(password, usuario.password);
        
        if (passwordValida) {
            // Ocultamos la contraseña en la respuesta
            const { password: _, ...usuarioSeguro } = usuario;
            res.json({ success: true, usuario: usuarioSeguro });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;




// RUTA PARA OBTENER EL ESTADO DEL EMPLEADO
app.get('/api/empleado/estado/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT estado FROM progreso_capacitacion WHERE usuario_id = $1 LIMIT 1',
            [usuario_id]
        );
        if (result.rows.length > 0) {
            res.json({ estado: result.rows[0].estado });
        } else {
            res.json({ estado: 'Pendiente' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RUTA PARA COMPLETAR LA CAPACITACIÓN (Recibir nota y firma)
app.post('/api/empleado/completar', async (req, res) => {
    const { usuario_id, curso_id, nota, firma_base64 } = req.body;
    const nuevoEstado = nota >= 14 ? 'Apto' : 'Pendiente';

    try {
        // Verificamos si ya existe el registro de progreso
        const existe = await pool.query(
            'SELECT id FROM progreso_capacitacion WHERE usuario_id = $1 AND curso_id = $2',
            [usuario_id, curso_id]
        );

        if (existe.rows.length > 0) {
            await pool.query(
                'UPDATE progreso_capacitacion SET nota = $1, estado = $2, firma_base64 = $3, fecha_completado = NOW() WHERE usuario_id = $4 AND curso_id = $5',
                [nota, nuevoEstado, firma_base64, usuario_id, curso_id]
            );
        } else {
            await pool.query(
                'INSERT INTO progreso_capacitacion (usuario_id, curso_id, nota, estado, firma_base64) VALUES ($1, $2, $3, $4, $5)',
                [usuario_id, curso_id, nota, nuevoEstado, firma_base64]
            );
        }
        res.json({ success: true, estado: nuevoEstado });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
    });


    // RUTA PARA QUE EL EMPLEADO VEA SUS CURSOS ASIGNADOS
app.get('/api/empleado/mis-cursos/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    try {
        const query = `
            SELECT c.id, c.titulo, c.descripcion, COALESCE(p.estado, 'Pendiente') AS estado
            FROM cursos c
            INNER JOIN progreso_capacitacion p ON p.curso_id = c.id
            WHERE p.usuario_id = $1
        `;
        const result = await pool.query(query, [usuario_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});





app.listen(PORT, () => console.log(`CodePapu Backend corriendo en el puerto ${PORT}`));