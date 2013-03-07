<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
include_once("header.php");

$errors = array();
$required_fields = array('role') ;

if(isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){

		$theRole = mysql_real_escape_string($_POST['role']);

		$newUR = UserRole::newUserRole($theRole);

		if($newUR->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create new user role. " . mysql_error());
		}

	} else {
		foreach($errors as $error){
			echo "<p>$error</p></br>";
		}
	}
}

?>

<div id="registerErrorMessages"></div>
<div id="registration">
	<form id="userRoleInputForm" action="userRoleInput.php" method="post">
		<fieldset>
			<legend>New Role:</legend>
			<p>
				<label for="role">Role:</label>
				<input class="text" id="role" type="text" name="role"/></br> 
			</p>
			<p>
				<input id="submit" name="submit" type="hidden"/></br>
				<input id="userRoleSubmit" name="submit" type="submit"/></br>
			</p>
		</fieldset>
	</form>
</div>

<script>
	$('#addEditRoleBlock').unbind();
	$('#addEditRoleBlock').on("click","#userRoleSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();


//		alert('12');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var role = $('form[id="userRoleInputForm"] #role').val();

		if(role == ''){
			valid += '<p> A role is required. </p>';
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			registrationFormData = $('form[id="userRoleInputForm"]').serialize();
			submitUserRoleData(registrationFormData);
		}
	});

	
	function submitUserRoleData(formData){
		$.ajax({
			type:'POST',
			url: 'userRoleInput2.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
				$("#settingsControls").load("userRoleALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="userRoleInputForm"]')[0].reset();
			}
		});
	};
</script>