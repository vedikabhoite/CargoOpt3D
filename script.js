let cartons = [];

const cartonGeometry =
    new THREE.BoxGeometry(
        2,
        2,
        2
    );

const cartonMaterial =
    new THREE.MeshNormalMaterial();

const carton =
    new THREE.Mesh(
        cartonGeometry,
        cartonMaterial
    );

placements.forEach(item => {

    const box =
        new THREE.Mesh(
            cartonGeometry,
            cartonMaterial
        );

    box.position.set(
        item.x/10,
        item.y/10,
        item.z/10
    );

    scene.add(box);
});


scene.add(carton);

// --------------------
// Add Carton
// --------------------
function addCarton() {

    let name =
        document.getElementById("cartonName").value;

    let length =
        Number(document.getElementById("boxLength").value);

    let width =
        Number(document.getElementById("boxWidth").value);

    let height =
        Number(document.getElementById("boxHeight").value);

    let quantity =
        Number(document.getElementById("quantity").value);

    let volume =
        length * width * height;

    cartons.push({
        name,
        length,
        width,
        height,
        quantity,
        volume
    });

    displayCartons();

    // Clear Inputs
    document.getElementById("cartonName").value = "";
    document.getElementById("boxLength").value = "";
    document.getElementById("boxWidth").value = "";
    document.getElementById("boxHeight").value = "";
    document.getElementById("quantity").value = "";
}

// --------------------
// Display Cartons Table
// --------------------
function displayCartons() {

    let tbody =
        document.querySelector("#cartonTable tbody");

    tbody.innerHTML = "";

    cartons.forEach(carton => {

        tbody.innerHTML += `
        <tr>
            <td>${carton.name}</td>
            <td>${carton.length}</td>
            <td>${carton.width}</td>
            <td>${carton.height}</td>
            <td>${carton.quantity}</td>
            <td>${carton.volume}</td>
        </tr>
        `;
    });
}

// --------------------
// Optimization Engine
// --------------------
function calculate() {

    let cLength =
        Number(document.getElementById("cLength").value);

    let cWidth =
        Number(document.getElementById("cWidth").value);

    let cHeight =
        Number(document.getElementById("cHeight").value);

    let containerVolume =
        cLength * cWidth * cHeight;

    let remainingSpace =
        containerVolume;

    let loaded = [];
    let rejected = [];

    let placements = [];

    let currentX = 0;
    let currentY = 0;
    let currentZ = 0;

    // Sort by largest volume first
    cartons.sort(
        (a, b) => b.volume - a.volume
    );

    cartons.forEach(carton => {

        let maxFit =
            Math.floor(
                remainingSpace /
                carton.volume
            );

        let loadedQty =
            Math.min(
                maxFit,
                carton.quantity
            );

        let rejectedQty =
            carton.quantity -
            loadedQty;

        if (loadedQty > 0) {

            loaded.push({
                name: carton.name,
                length: carton.length,
                width: carton.width,
                height: carton.height,
                quantity: loadedQty
            });

            // Generate placement coordinates
            for (let i = 0; i < loadedQty; i++) {

                placements.push({
                    name: carton.name,
                    x: currentX,
                    y: currentY,
                    z: currentZ
                });

                currentX += carton.length;

                if (currentX + carton.length > cLength) {
                    currentX = 0;
                    currentY += carton.width;
                }

                if (currentY + carton.width > cWidth) {
                    currentY = 0;
                    currentZ += carton.height;
                }
            }

            remainingSpace -=
                loadedQty * carton.volume;
        }

        if (rejectedQty > 0) {

            rejected.push({
                name: carton.name,
                length: carton.length,
                width: carton.width,
                height: carton.height,
                quantity: rejectedQty
            });
        }
    });

    let usedVolume =
        containerVolume -
        remainingSpace;

    let utilization =
        (usedVolume / containerVolume) * 100;

    document.getElementById("result").innerHTML = `

        <h2>Optimization Results</h2>

        <p>
            <strong>Container Volume:</strong>
            ${containerVolume}
        </p>

        <p>
            <strong>Used Volume:</strong>
            ${usedVolume}
        </p>

        <p>
            <strong>Free Space:</strong>
            ${remainingSpace}
        </p>

        <p>
            <strong>Utilization:</strong>
            ${utilization.toFixed(2)}%
        </p>

        <hr>

        <h3>Loaded Cartons</h3>

        ${
            loaded.length > 0
            ?
            loaded.map(carton => `
                <p>
                    <strong>${carton.name}</strong><br>
                    Size:
                    ${carton.length} x
                    ${carton.width} x
                    ${carton.height}<br>
                    Loaded Qty:
                    ${carton.quantity}
                </p>
            `).join("")
            :
            "<p>None</p>"
        }

        <hr>

        <h3>Rejected Cartons</h3>

        ${
            rejected.length > 0
            ?
            rejected.map(carton => `
                <p>
                    <strong>${carton.name}</strong><br>
                    Size:
                    ${carton.length} x
                    ${carton.width} x
                    ${carton.height}<br>
                    Rejected Qty:
                    ${carton.quantity}
                </p>
            `).join("")
            :
            "<p>None</p>"
        }

        <hr>

        <h3>Placement Coordinates</h3>

        ${
            placements.length > 0
            ?
            placements.map(item => `
                ${item.name}
                → (${item.x}, ${item.y}, ${item.z})
                <br>
            `).join("")
            :
            "<p>No placements generated</p>"
        }
    `;
}

    // Sort by largest volume first
    cartons.sort(
        (a, b) => b.volume - a.volume
    );

    cartons.forEach(carton => {

        let maxFit =
            Math.floor(
                remainingSpace /
                carton.volume
            );

        let loadedQty =
            Math.min(
                maxFit,
                carton.quantity
            );

        let rejectedQty =
            carton.quantity -
            loadedQty;

        if (loadedQty > 0) {

            loaded.push({
                name: carton.name,
                length: carton.length,
                width: carton.width,
                height: carton.height,
                quantity: loadedQty
            });

            remainingSpace -=
                loadedQty *
                carton.volume;
        }

        if (rejectedQty > 0) {

            rejected.push({
                name: carton.name,
                length: carton.length,
                width: carton.width,
                height: carton.height,
                quantity: rejectedQty
            });
        }
    });

    let usedVolume =
        containerVolume -
        remainingSpace;

    let utilization =
        (usedVolume / containerVolume) * 100;

    document.getElementById("result").innerHTML = `

        <h2>Optimization Results</h2>

        <p>
            <strong>Container Volume:</strong>
            ${containerVolume}
        </p>

        <p>
            <strong>Used Volume:</strong>
            ${usedVolume}
        </p>

        <p>
            <strong>Free Space:</strong>
            ${remainingSpace}
        </p>

        <p>
            <strong>Utilization:</strong>
            ${utilization.toFixed(2)}%
        </p>

        <hr>

        <h3>Loaded Cartons</h3>

        ${
            loaded.length > 0
            ?
            loaded.map(carton => `
                <p>
                    <strong>${carton.name}</strong><br>
                    Size:
                    ${carton.length} x
                    ${carton.width} x
                    ${carton.height}<br>
                    Loaded Qty:
                    ${carton.quantity}
                </p>
            `).join("")
            :
            "<p>None</p>"
        }

        <hr>

        <h3>Rejected Cartons</h3>

        ${
            rejected.length > 0
            ?
            rejected.map(carton => `
                <p>
                    <strong>${carton.name}</strong><br>
                    Size:
                    ${carton.length} x
                    ${carton.width} x
                    ${carton.height}<br>
                    Rejected Qty:
                    ${carton.quantity}
                </p>
            `).join("")
            :
            "<p>None</p>"
        }
    `;
