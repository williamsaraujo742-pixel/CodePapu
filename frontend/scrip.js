const loginForm = document.getElementById('loginForm');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorMsg = document.getElementById('errorMessage');

        errorMsg.textContent = 'Verificando...';

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                // Guardar usuario en localStorage
                localStorage.setItem('usuarioCodePapu', JSON.stringify(data.usuario));
                
                // Redirección dinámica según el rol
                if (data.usuario.rol === 'admin') {
                    window.location.href = 'matriz.html'; // Vista del admin
                } else {
                    window.location.href = 'capacitacion.html'; // Vista del empleado
                }
            } else {
                errorMsg.textContent = data.message;
            }
        } catch (err) {
            errorMsg.textContent = 'Error de conexión con el servidor.';
        }
    });
}