const part1 = document.getElementById('roomCodePart1');
const part2 = document.getElementById('roomCodePart2');
const part3 = document.getElementById('roomCodePart3');
const roomCodeInput = document.getElementById('roomCodeInput');
const btnJoinPin = document.getElementById('btnJoinPin');

function moveToNextInput(currentInput, nextInput) {
    if (currentInput.value.length === currentInput.maxLength && nextInput) {
        nextInput.focus();
    }
}

part1.addEventListener('input', () => moveToNextInput(part1, part2));
part2.addEventListener('input', () => moveToNextInput(part2, part3));

part3.addEventListener('input', () => {
    if (part3.value.length === part3.maxLength) {
        const fullCode = part1.value.toUpperCase() + part2.value.toUpperCase() + part3.value.toUpperCase();
        roomCodeInput.value = fullCode;
        // Tutaj możesz dodać logikę aktywującą przycisk "Dołącz" lub wykonującą inne akcje
        console.log("Pełny kod:", fullCode);
    }
});

btnJoinPin.addEventListener('click', () => {
    const fullCode = roomCodeInput.value;
    if (fullCode.length === 3) {
        alert(`Próba dołączenia do pokoju z kodem: ${fullCode}`);
        // Tutaj dodaj logikę dołączenia do pokoju z kodem
    } else {
        alert('Wprowadź 3-znakowy kod pokoju.');
    }
});
