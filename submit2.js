$(document).ready(function() {

	$('#users').unbind().click(function(e){
		e.preventDefault();

		alert('1');
		$('#users').off();
		$('#userRoleAdd').off();
		$('a[id*="editUser"]').off();
		$('a[id*="editRole"]').off();
		$('a[id*="editCategory"]').off();
		$('#settingsControls').off();
		$('#categoryAdd').off();
		$('#editCategory').off();
		$('#noteListing').off();
		$('#userRoleSubmit').off();
		$("#editUserSubmit").off();
		$("#registerSubmit").off();
		$("#noteSubmit").off();
		$("categorySubmitButton").off();
		$("#editRoleSubmit").off();
		$("#topicAdd").off();

		$('#addEditRoleBlock').off();

		$('#settingsControls').load('userALE.php');
	});


	$('#userRoleAdd').unbind().click(function(e){
		e.preventDefault();

		alert('2');

		$('#users').off();
		$('#userRoleAdd').off();
		$('a[id*="editUser"]').off();
		$('a[id*="editRole"]').off();
		$('a[id*="editCategory"]').off();
		$('#settingsControls').off();
		$('#categoryAdd').off();
		$('#editCategory').off();
		$('#noteListing').off();
		$('#userRoleSubmit').off();
		$("#editUserSubmit").off();
		$("#registerSubmit").off();
		$("#noteSubmit").off();
		$("categorySubmitButton").off();
		$("#editRoleSubmit").off();
		$("#topicAdd").off();
		
		$('#addEditRoleBlock').off();

		$('#settingsControls').load('userRoleALE.php');
	});


	$('#categoryAdd').unbind().click(function(e){
		e.preventDefault();

		alert('5');

		$('#users').off();
		$('#userRoleAdd').off();
		$('a[id*="editUser"]').off();
		$('a[id*="editRole"]').off();
		$('a[id*="editCategory"]').off();
		$('#settingsControls').off();
		$('#categoryAdd').off();
		$('#editCategory').off();
		$('#noteListing').off();
		$('#userRoleSubmit').off();
		$("#editUserSubmit").off();
		$("#registerSubmit").off();
		$("#noteSubmit").off();
		$("categorySubmitButton").off();
		$("#editRoleSubmit").off();
		$("#topicAdd").off();
		
		$('#addEditRoleBlock').off();

		$('#settingsControls').load('categoryALE.php');
	});

	

	$('#noteListing').unbind().click(function(e){
		e.preventDefault();

		alert('7');

		$('#users').off();
		$('#userRoleAdd').off();
		$('a[id*="editUser"]').off();
		$('a[id*="editRole"]').off();
		$('a[id*="editCategory"]').off();
		$('#settingsControls').off();
		$('#categoryAdd').off();
		$('#editCategory').off();
		$('#noteListing').off();
		$('#userRoleSubmit').off();
		$("#editUserSubmit").off();
		$("#registerSubmit").off();
		$("#noteSubmit").off();
		$("categorySubmitButton").off();
		$("#editRoleSubmit").off();
		$("#topicAdd").off();
		
		$('#addEditRoleBlock').off();

		$('#settingsControls').load('noteALE.php');
	});

});